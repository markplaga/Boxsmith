'use strict';

/* Boxsmith box type files: the format, its formula language, and the structural checks.
   A box type file is plain JSON (format "boxsmith-type", version 1). It says what a box is made of
   (finger-jointed boxes, flat panels, dividers, and dowels to buy), with sizes and positions written as formulas, and
   which settings the user can change. It never contains code: formulas are parsed by the small
   language below and can only use the names and functions listed here, so a type file from anyone
   is safe to open. The geometry itself is built by app.js (generateCustom) with Boxsmith's own joint
   engine, and checked by the engine (Boxsmith.types.check). Works in the browser and in Node. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.BoxTypes=api;
})(globalThis,function(){
  const FORMAT='boxsmith-type', VERSION=1;
  const isRecord=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);

  /* ================= formulas =================
     Numbers, 'strings', true/false, lists [a, b, c], names, + - * / %, comparisons == != < <= > >=,
     && || !, cond ? a : b, list[i], and calls to the functions in FUNCS. Lists of numbers add and
     subtract element by element and multiply or divide by a number, so [x,y,z] works as a vector.
     Every length is in millimetres. */
  class FormulaError extends Error{}
  const MAX_LIST=20000, MAX_NODES=4000;

  function tokenize(src){
    const out=[]; let i=0;
    while(i<src.length){
      const c=src[i];
      if(/\s/.test(c)){ i++; continue; }
      if(/[0-9.]/.test(c)){
        const m=/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
        if(!m) throw new FormulaError('a number is written wrongly at position '+(i+1));
        out.push({k:'num',v:parseFloat(m[0]),p:i}); i+=m[0].length; continue;
      }
      if(/[A-Za-z_]/.test(c)){
        const m=/^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        const w=m[0];
        out.push(w==='true'||w==='false'?{k:'val',v:w==='true',p:i}:{k:'name',v:w,p:i}); i+=w.length; continue;
      }
      if(c==="'"||c==='"'){
        let j=i+1, s='';
        while(j<src.length&&src[j]!==c){ if(src[j]==='\\'&&j+1<src.length){ s+=src[j+1]; j+=2; } else s+=src[j++]; }
        if(j>=src.length) throw new FormulaError('a text in quotes is not closed');
        out.push({k:'val',v:s,p:i}); i=j+1; continue;
      }
      const two=src.slice(i,i+2);
      if(['==','!=','<=','>=','&&','||'].includes(two)){ out.push({k:'op',v:two,p:i}); i+=2; continue; }
      if('+-*/%<>!?:()[],'.includes(c)){ out.push({k:'op',v:c,p:i}); i++; continue; }
      throw new FormulaError('"'+c+'" is not allowed in a formula (position '+(i+1)+')');
    }
    return out;
  }
  // Recursive descent into a small tree: {t:'num'|'val'|'name'|'list'|'un'|'bin'|'cond'|'call'|'index', …}
  function parse(src){
    if(typeof src!=='string') throw new FormulaError('a formula must be text');
    const tk=tokenize(src); let i=0, nodes=0;
    const peek=()=>tk[i], isOp=v=>tk[i]&&tk[i].k==='op'&&tk[i].v===v;
    const need=v=>{ if(!isOp(v)) throw new FormulaError(tk[i]?'expected "'+v+'" at position '+(tk[i].p+1):'expected "'+v+'" at the end'); i++; };
    const node=n=>{ if(++nodes>MAX_NODES) throw new FormulaError('the formula is too long'); return n; };
    const bin=(next,ops)=>()=>{ let a=next(); while(tk[i]&&tk[i].k==='op'&&ops.includes(tk[i].v)){ const op=tk[i++].v; a=node({t:'bin',op,a,b:next()}); } return a; };
    function primary(){
      const x=peek(); if(!x) throw new FormulaError('the formula ends too early');
      if(x.k==='num'||x.k==='val'){ i++; return node({t:'val',v:x.v}); }
      if(x.k==='name'){
        i++;
        if(isOp('(')){ i++; const args=[]; if(!isOp(')')){ do{ args.push(ternary()); }while(isOp(',')&&++i); } need(')'); return node({t:'call',f:x.v,args,p:x.p}); }
        return node({t:'name',v:x.v,p:x.p});
      }
      if(isOp('(')){ i++; const e=ternary(); need(')'); return e; }
      if(isOp('[')){ i++; const items=[]; if(!isOp(']')){ do{ items.push(ternary()); }while(isOp(',')&&++i); } need(']'); return node({t:'list',items}); }
      throw new FormulaError('unexpected "'+(x.v)+'" at position '+(x.p+1));
    }
    function postfix(){ let e=primary(); while(isOp('[')){ i++; const ix=ternary(); need(']'); e=node({t:'index',e,ix}); } return e; }
    function unary(){ if(isOp('-')||isOp('!')||isOp('+')){ const op=tk[i++].v; return node({t:'un',op,a:unary()}); } return postfix(); }
    const mul=bin(unary,['*','/','%']), add=bin(mul,['+','-']), cmp=bin(add,['<','<=','>','>=']), eq=bin(cmp,['==','!=']);
    const and=bin(eq,['&&']), or=bin(and,['||']);
    function ternary(){ const c=or(); if(isOp('?')){ i++; const a=ternary(); need(':'); const b=ternary(); return node({t:'cond',c,a,b}); } return c; }
    const tree=ternary();
    if(i<tk.length) throw new FormulaError('unexpected "'+tk[i].v+'" at position '+(tk[i].p+1));
    return tree;
  }
  const kindOf=v=>Array.isArray(v)?'list':typeof v==='boolean'?'true/false':typeof v==='string'?'text':'number';
  const num=(v,what)=>{ if(typeof v!=='number'||!Number.isFinite(v)) throw new FormulaError(what+' must be a number, not '+(typeof v==='number'?'an impossible number (divided by 0?)':kindOf(v))); return v; };
  const list=(v,what)=>{ if(!Array.isArray(v)) throw new FormulaError(what+' must be a list'); return v; };
  const truthy=v=>Array.isArray(v)?v.length>0:!!v;
  function arith(op,a,b){
    if(typeof a==='number'&&typeof b==='number'){
      const r=op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:op==='/'?a/b:a%b;
      if(!Number.isFinite(r)) throw new FormulaError(op==='/'||op==='%'?'division by 0':'a number got too big');
      return r;
    }
    if(op==='+'&&(typeof a==='string'||typeof b==='string')) return String(a)+String(b);
    if(Array.isArray(a)&&Array.isArray(b)&&(op==='+'||op==='-')){
      if(a.length!==b.length) throw new FormulaError('lists of different lengths ('+a.length+' and '+b.length+') can\'t be added');
      return a.map((x,k)=>arith(op,x,b[k]));
    }
    if(Array.isArray(a)&&typeof b==='number'&&op!=='%') return a.map(x=>arith(op,x,b));
    if(typeof a==='number'&&Array.isArray(b)&&op==='*') return b.map(x=>arith(op,a,x));
    throw new FormulaError('can\'t use '+op+' between a '+kindOf(a)+' and a '+kindOf(b));
  }
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const PTS=n=>{ if(n>MAX_LIST) throw new FormulaError('a list would have more than '+MAX_LIST+' items'); return n; };
  /* The functions a formula may call. host is supplied by the builder (app.js) for the ones that need
     Boxsmith's geometry: fingers(), handleHoles(), fmt(). */
  const FUNCS={
    min:(...a)=>{ if(!a.length) throw new FormulaError('min needs numbers'); return Math.min(...a.flat().map(v=>num(v,'min'))); },
    max:(...a)=>{ if(!a.length) throw new FormulaError('max needs numbers'); return Math.max(...a.flat().map(v=>num(v,'max'))); },
    abs:x=>Math.abs(num(x,'abs')), round:(x,d=0)=>{ const k=10**num(d,'round places'); return Math.round(num(x,'round')*k)/k; },
    floor:x=>Math.floor(num(x,'floor')), ceil:x=>Math.ceil(num(x,'ceil')), sqrt:x=>{ if(num(x,'sqrt')<0) throw new FormulaError('sqrt of a negative number'); return Math.sqrt(x); },
    pow:(x,y)=>num(Math.pow(num(x,'pow'),num(y,'pow')),'pow'), hypot:(...a)=>Math.hypot(...a.map(v=>num(v,'hypot'))),
    sin:x=>Math.sin(num(x,'sin')), cos:x=>Math.cos(num(x,'cos')), tan:x=>Math.tan(num(x,'tan')),
    asin:x=>Math.asin(num(x,'asin')), acos:x=>Math.acos(num(x,'acos')), atan:x=>Math.atan(num(x,'atan')), atan2:(y,x)=>Math.atan2(num(y,'atan2'),num(x,'atan2')),
    rad:x=>num(x,'rad')*Math.PI/180, deg:x=>num(x,'deg')*180/Math.PI,
    clamp:(x,lo,hi)=>Math.min(Math.max(num(x,'clamp'),num(lo,'clamp')),num(hi,'clamp')),
    count:x=>list(x,'count').length, sum:x=>list(x,'sum').reduce((a,v)=>a+num(v,'sum'),0),
    range:(a,b,s=1)=>{ if(b===undefined){ b=a; a=0; } num(a,'range'); num(b,'range'); num(s,'range step'); if(s===0) throw new FormulaError('range step can\'t be 0'); const out=[]; for(let x=a;s>0?x<b-1e-9:x>b+1e-9;x+=s){ out.push(x); PTS(out.length); } return out; },
    concat:(...a)=>{ const out=[]; for(const x of a) Array.isArray(x)?out.push(...x):out.push(x); PTS(out.length); return out; },
    pick:(xs,i)=>{ list(xs,'pick'); num(i,'pick index'); if(!Number.isInteger(i)||i<0||i>=xs.length) throw new FormulaError('pick: there is no item '+i); return xs[i]; },
    axis:i=>{ num(i,'axis'); if(![0,1,2].includes(i)) throw new FormulaError('axis takes 0, 1 or 2'); return [0,0,0].map((_,k)=>k===i?1:0); },
    vec:(x,y,z)=>[num(x,'vec'),num(y,'vec'),num(z,'vec')],
    // points along an ellipse arc, a0 to a1 in radians, n segments (n+1 points)
    arc:(cx,cy,rx,ry,a0,a1,n)=>{ [cx,cy,rx,ry,a0,a1,n].forEach(v=>num(v,'arc')); n=Math.max(1,Math.min(2000,Math.round(n))); const out=[]; for(let i=0;i<=n;i++){ const a=a0+(a1-a0)*i/n; out.push([cx+rx*Math.cos(a),cy+ry*Math.sin(a)]); } return out; },
    rect:(x,y,w,h)=>{ [x,y,w,h].forEach(v=>num(v,'rect')); return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]]; },
    // a rounded slot (stadium) centred on cx, cy
    slot:(cx,cy,w,h)=>{ [cx,cy,w,h].forEach(v=>num(v,'slot')); const r=Math.min(w,h)/2, out=[]; if(w>=h){ for(let i=0;i<=12;i++){ const a=-Math.PI/2+Math.PI*i/12; out.push([cx+w/2-r+r*Math.cos(a),cy+r*Math.sin(a)]); } for(let i=0;i<=12;i++){ const a=Math.PI/2+Math.PI*i/12; out.push([cx-w/2+r+r*Math.cos(a),cy+r*Math.sin(a)]); } } else { for(let i=0;i<=12;i++){ const a=Math.PI*i/12; out.push([cx+r*Math.cos(a),cy+h/2-r+r*Math.sin(a)]); } for(let i=0;i<=12;i++){ const a=Math.PI+Math.PI*i/12; out.push([cx+r*Math.cos(a),cy-h/2+r+r*Math.sin(a)]); } } return out; },
    move:(pts,dx,dy)=>list(pts,'move').map(p=>[num(p[0],'move')+num(dx,'move'),num(p[1],'move')+num(dy,'move')]),
    str:x=>String(x)
  };
  const CONSTS={PI:Math.PI,X:[1,0,0],Y:[0,1,0],Z:[0,0,1]};
  function evaluate(tree,env,host={}){
    const ev=n=>{
      switch(n.t){
        case 'val': return n.v;
        case 'name':
          if(Object.prototype.hasOwnProperty.call(env,n.v)) return env[n.v];
          if(Object.prototype.hasOwnProperty.call(CONSTS,n.v)) return CONSTS[n.v];
          throw new FormulaError('there is nothing called "'+n.v+'"'+near(n.v,env));
        case 'list': { const v=n.items.map(ev); PTS(v.length); return v; }
        case 'index': { const a=ev(n.e), i=ev(n.ix); if(!Array.isArray(a)) throw new FormulaError('only a list can be indexed with [ ]'); num(i,'an index'); if(!Number.isInteger(i)||i<0||i>=a.length) throw new FormulaError('there is no item '+i+' in a list of '+a.length); return a[i]; }
        case 'un': { const a=ev(n.a); if(n.op==='!') return !truthy(a); if(n.op==='+') return num(a,'+'); return typeof a==='number'?-a:Array.isArray(a)?arith('*',-1,a):num(a,'-'); }
        case 'cond': return truthy(ev(n.c))?ev(n.a):ev(n.b);
        case 'bin': {
          if(n.op==='&&'){ const a=ev(n.a); return truthy(a)?ev(n.b):a; }
          if(n.op==='||'){ const a=ev(n.a); return truthy(a)?a:ev(n.b); }
          const a=ev(n.a), b=ev(n.b);
          if(n.op==='==') return same(a,b); if(n.op==='!=') return !same(a,b);
          if(['<','<=','>','>='].includes(n.op)){ num(a,n.op); num(b,n.op); return n.op==='<'?a<b:n.op==='<='?a<=b:n.op==='>'?a>b:a>=b; }
          return arith(n.op,a,b);
        }
        case 'call': {
          const f=Object.prototype.hasOwnProperty.call(host,n.f)?host[n.f]:Object.prototype.hasOwnProperty.call(FUNCS,n.f)?FUNCS[n.f]:null;
          if(!f) throw new FormulaError('there is no function "'+n.f+'"'+near(n.f,Object.fromEntries(Object.keys(FUNCS).concat(Object.keys(host)).map(k=>[k,1]))));
          return f(...n.args.map(ev));
        }
      }
    };
    return ev(tree);
  }
  // "did you mean …?" for a misspelt name
  function near(name,env){
    let best=null, bd=3;
    for(const k of Object.keys(env)){ const d=editDistance(name.toLowerCase(),k.toLowerCase()); if(d<bd){ bd=d; best=k; } }
    return best?' (did you mean "'+best+'"?)':'';
  }
  function editDistance(a,b){ const m=a.length, n=b.length; if(Math.abs(m-n)>2) return 9; const d=[...Array(n+1).keys()]; for(let i=1;i<=m;i++){ let prev=d[0]; d[0]=i; for(let j=1;j<=n;j++){ const t=d[j]; d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a[i-1]===b[j-1]?0:1)); prev=t; } } return d[n]; }
  const cache=new Map();
  // Evaluate a formula string (or pass a number, boolean or list of them through).
  function formula(src,env,host){
    if(typeof src==='number'||typeof src==='boolean') return src;
    if(Array.isArray(src)) return src.map(x=>formula(x,env,host));
    let tree=cache.get(src); if(!tree){ tree=parse(src); if(cache.size>5000) cache.clear(); cache.set(src,tree); }
    return evaluate(tree,env,host);
  }
  // Text with {formula} pieces, e.g. "Openings: {fmt(W-2*w)} wide". {#expr} numbers repeats: 1, 2, 3 per value.
  function template(text,env,host,counters){
    return String(text).replace(/\{(#?)([^{}]+)\}/g,(_,hash,src)=>{
      const v=formula(src.trim(),env,host);
      if(!hash) return typeof v==='number'?String(Math.round(v*1000)/1000):String(v);
      const key=src.trim()+'='+JSON.stringify(v); counters[key]=(counters[key]||0)+1; return String(counters[key]);
    });
  }

  /* ================= the format ================= */
  const EDGES=['e','f','F'];                     // Boxes.py letters: e plain, f fingers, F their partner
  const AXES={X:[1,0,0],'-X':[-1,0,0],Y:[0,1,0],'-Y':[0,-1,0],Z:[0,0,1],'-Z':[0,0,-1]};
  const FACES=['bottom','top','front','back','left','right'];
  const PARAM_KINDS=['length','number','integer','bool','choice','text','color'];
  const ID=/^[a-z][a-z0-9-]{1,39}$/, KEY=/^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
  // names a formula can always use (besides the type's own params and lets)
  const BUILT_IN_NAMES=['W','D','H','t','fw','clr','inside','text','tslot','corners','tAcr'];

  /* validateType(def, {standardKeys, builtInIds}) → {ok, errors:[{path, message}], warnings:[…]}
     Checks the shape of the file and that every formula parses. Whether the formulas work, and
     whether the parts fit together, is checked by building it (Boxsmith.types.check). */
  function validateType(def,opts={}){
    const errors=[], warnings=[], err=(path,message)=>errors.push({path,message}), warn=(path,message)=>warnings.push({path,message});
    if(!isRecord(def)) return {ok:false,errors:[{path:'',message:'A box type must be a JSON object.'}],warnings};
    if(def.format!==FORMAT) err('format','must be "'+FORMAT+'".');
    if(def.version!==VERSION) err('version','must be '+VERSION+'.');
    if(typeof def.id!=='string'||!ID.test(def.id)) err('id','must be 2-40 characters: lower-case letters, digits and dashes, starting with a letter (like "tray-with-lip").');
    else if((opts.builtInIds||[]).includes(def.id)) err('id','"'+def.id+'" is the name of a built-in box style; choose another.');
    if(typeof def.name!=='string'||!def.name.trim()||def.name.length>40) err('name','must be a short name (1-40 characters).');
    if(def.description!==undefined&&(typeof def.description!=='string'||def.description.length>80)) err('description','must be text of up to 80 characters.');
    for(const k of ['author','typeVersion','icon','license']) if(def[k]!==undefined&&typeof def[k]!=='string') err(k,'must be text.');
    const known=new Set(['format','version','id','name','description','icon','author','typeVersion','license','inside','screws','params','let','warnings','parts','notes','info']);
    for(const k of Object.keys(def)) if(!known.has(k)) err(k,'is not part of the format (allowed: '+[...known].join(', ')+').');
    const checkF=(path,src,optional)=>{ if(src===undefined){ if(!optional) err(path,'is missing.'); return; } if(typeof src==='number'||typeof src==='boolean') return; if(Array.isArray(src)){ src.forEach((s,i)=>checkF(path+'['+i+']',s)); return; } if(typeof src!=='string'){ err(path,'must be a number or a formula.'); return; } try{ parse(src); }catch(e){ err(path,'formula "'+src+'": '+e.message+'.'); } };
    const checkT=(path,text)=>{ if(typeof text!=='string'){ err(path,'must be text.'); return; } for(const m of text.matchAll(/\{#?([^{}]+)\}/g)) checkF(path,m[1].trim()); };
    const vec=(path,v,n)=>{ if(typeof v==='string'){ checkF(path,v); return; } if(!Array.isArray(v)||v.length!==n){ err(path,'must be a list of '+n+' numbers or formulas, or one formula that gives such a list.'); return; } v.forEach((x,i)=>checkF(path+'['+i+']',x)); };
    // inside dimensions
    if(def.inside!==undefined){
      if(def.inside===false){}
      else if(!isRecord(def.inside)) err('inside','must be {"W":…, "D":…, "H":…} (what to add to inside sizes) or false.');
      else for(const [k,v] of Object.entries(def.inside)){ if(!['W','D','H'].includes(k)) err('inside.'+k,'only W, D and H can be given.'); else checkF('inside.'+k,v); }
    }
    if(def.screws!==undefined&&typeof def.screws!=='boolean') err('screws','must be true or false.');
    // params
    const names=new Set(BUILT_IN_NAMES), std=new Set(opts.standardKeys||[]);
    if(def.params!==undefined&&!Array.isArray(def.params)) err('params','must be a list.');
    (Array.isArray(def.params)?def.params:[]).forEach((p,i)=>{
      const path='params['+i+']';
      if(!isRecord(p)){ err(path,'must be an object.'); return; }
      if(typeof p.key!=='string'||!KEY.test(p.key)) err(path+'.key','must be a name of letters, digits and _ (starting with a letter).');
      else if(['W','D','H','t'].includes(p.key)) err(path+'.key','"'+p.key+'" is always there; don\'t list it as a parameter.');
      else if(names.has(p.key)&&!std.has(p.key)) err(path+'.key','"'+p.key+'" is used twice.');
      else names.add(p.key);
      if(!PARAM_KINDS.includes(p.kind)) err(path+'.kind','must be one of: '+PARAM_KINDS.join(', ')+'.');
      if(typeof p.label!=='string'||!p.label.trim()) err(path+'.label','must be the text the user sees.');
      const isNumKind=['length','number','integer'].includes(p.kind);
      if(p.default===undefined) err(path+'.default','is missing.');
      else if(isNumKind&&typeof p.default!=='number') err(path+'.default','must be a number.');
      else if(p.kind==='bool'&&typeof p.default!=='boolean') err(path+'.default','must be true or false.');
      else if((p.kind==='text'||p.kind==='choice')&&typeof p.default!=='string') err(path+'.default','must be text.');
      else if(p.kind==='color'&&!/^#[0-9a-f]{6}$/i.test(p.default)) err(path+'.default',"must be like '#3a7bd5'.");
      for(const k of ['min','max','step']) if(p[k]!==undefined&&(!isNumKind||typeof p[k]!=='number')) err(path+'.'+k,'only number kinds have '+k+', and it must be a number.');
      if(isNumKind&&typeof p.min==='number'&&typeof p.max==='number'&&p.min>p.max) err(path,'min is bigger than max.');
      if(isNumKind&&typeof p.default==='number'&&((typeof p.min==='number'&&p.default<p.min)||(typeof p.max==='number'&&p.default>p.max))) err(path+'.default','is outside min to max.');
      if(p.kind==='choice'){ if(!Array.isArray(p.choices)||!p.choices.length||!p.choices.every(c=>typeof c==='string'||(isRecord(c)&&typeof c.value==='string'))) err(path+'.choices','must list the choices (text, or {value, label}).'); else if(!p.choices.some(c=>(c.value??c)===p.default)) err(path+'.default','must be one of the choices.'); }
      if(p.showIf!==undefined) checkF(path+'.showIf',p.showIf);
      if(p.help!==undefined&&typeof p.help!=='string') err(path+'.help','must be text.');
    });
    // lets
    if(def.let!==undefined){ if(!isRecord(def.let)) err('let','must be an object of name: formula.'); else for(const [k,v] of Object.entries(def.let)){ if(!KEY.test(k)) err('let.'+k,'is not a usable name.'); else if(['W','D','H','t'].includes(k)) err('let.'+k,'can\'t be changed.'); checkF('let.'+k,v); } }
    // warnings and notes
    const whenText=(path,x)=>{ if(typeof x==='string') checkT(path,x); else if(isRecord(x)){ if(x.when!==undefined) checkF(path+'.when',x.when); checkT(path+'.text',x.text); } else err(path,'must be text, or {"when": formula, "text": "…"}.'); };
    for(const key of ['warnings','notes']) if(def[key]!==undefined){ if(!Array.isArray(def[key])) err(key,'must be a list.'); else def[key].forEach((x,i)=>whenText(key+'['+i+']',x)); }
    if(def.info!==undefined){
      if(!isRecord(def.info)) err('info','must be an object.');
      else { if(def.info.when!==undefined) checkF('info.when',def.info.when);
        for(const k of ['inner','hole']) if(def.info[k]!==undefined){ const v=def.info[k]; if(!isRecord(v)) err('info.'+k,'must be {"W":…, "D":…, "H":…}.'); else for(const [kk,vv] of Object.entries(v)) if(kk==='label'){ if(typeof vv!=='string') err('info.'+k+'.label','must be text.'); } else checkF('info.'+k+'.'+kk,vv); } }
    }
    // parts
    if(!Array.isArray(def.parts)||!def.parts.length) err('parts','must list at least one part (a box, a panel, dividers or a dowel).');
    else def.parts.forEach((c,i)=>checkComponent('parts['+i+']',c));
    function checkEdge(path,e){ if(typeof e==='string'){ if(EDGES.includes(e)) return; checkF(path,e); return; } if(Array.isArray(e)){ vec(path,e,e.length); return; } err(path,'must be "e" (plain), "f" (fingers), "F" (their partner), or a formula giving one of those or a list of points.'); }
    function checkHole(path,h){
      if(typeof h==='string'){ checkF(path,h); return; }
      if(!isRecord(h)){ err(path,'must be a shape object or a formula.'); return; }
      const kinds=['rect','circle','slot','polygon','fingers'].filter(k=>h[k]!==undefined);
      if(kinds.length!==1){ err(path,'must have exactly one of: rect, circle, slot, polygon, fingers.'); return; }
      const k=kinds[0], v=h[k];
      if(k==='rect'||k==='slot') vec(path+'.'+k,v,4);
      else if(k==='circle') vec(path+'.circle',v,3);
      else if(k==='polygon'){ if(typeof v==='string') checkF(path+'.polygon',v); else if(!Array.isArray(v)||v.length<3) err(path+'.polygon','must list at least 3 points, or be a formula.'); else v.forEach((p,j)=>vec(path+'.polygon['+j+']',p,2)); }
      else if(k==='fingers'){ if(!isRecord(v)) err(path+'.fingers','must be {"size":[w,h], "edges":[4 edges], "at":[x,y]}.'); else { vec(path+'.fingers.size',v.size,2); if(!Array.isArray(v.edges)||v.edges.length!==4) err(path+'.fingers.edges','must list 4 edges (top, right, bottom, left).'); else v.edges.forEach((e,j)=>checkEdge(path+'.fingers.edges['+j+']',e)); if(v.at!==undefined) vec(path+'.fingers.at',v.at,2); } }
      for(const kk of Object.keys(h)) if(kk!==k) err(path+'.'+kk,'is not part of a hole.');
    }
    function checkHoles(path,hs){ if(typeof hs==='string'){ checkF(path,hs); return; } if(!Array.isArray(hs)){ err(path,'must be a list of holes, or a formula.'); return; } hs.forEach((h,j)=>checkHole(path+'['+j+']',h)); }
    function checkAxis(path,a){ if(typeof a==='string'&&AXES[a]) return; vec(path,a,3); }
    function checkComponent(path,c){
      if(!isRecord(c)){ err(path,'must be an object with one of: box, panel, dividers, dowel, pivot.'); return; }
      const kinds=['box','panel','dividers','dowel','pivot'].filter(k=>c[k]!==undefined);
      if(kinds.length!==1){ err(path,'must have exactly one of: box, panel, dividers, dowel, pivot.'); return; }
      for(const k of Object.keys(c)) if(!['box','panel','dividers','dowel','pivot','when','for','let','frame'].includes(k)) err(path+'.'+k,'is not allowed here (allowed: box, panel, dividers, dowel, pivot, when, for, let, frame).');
      if(c.frame!==undefined){ if(typeof c.frame!=='string'||!c.frame.trim()) err(path+'.frame','must be the name of a frame (a pivot\'s "child").'); else checkT(path+'.frame',c.frame); }
      if(c.when!==undefined) checkF(path+'.when',c.when);
      if(c.for!==undefined){ if(!isRecord(c.for)||!Object.keys(c.for).length) err(path+'.for','must be {"name": list or formula, …}.'); else for(const [k,v] of Object.entries(c.for)){ if(!KEY.test(k)) err(path+'.for.'+k,'is not a usable name.'); if(Array.isArray(v)) v.forEach((x,j)=>checkF(path+'.for.'+k+'['+j+']',x)); else checkF(path+'.for.'+k,v); } }
      if(c.let!==undefined){ if(!isRecord(c.let)) err(path+'.let','must be an object of name: formula.'); else for(const [k,v] of Object.entries(c.let)){ if(!KEY.test(k)) err(path+'.let.'+k,'is not a usable name.'); checkF(path+'.let.'+k,v); } }
      const k=kinds[0], b=c[k], p=path+'.'+k;
      if(!isRecord(b)){ err(p,'must be an object.'); return; }
      const allow=(list)=>{ for(const kk of Object.keys(b)) if(!list.includes(kk)) err(p+'.'+kk,'is not part of a '+k+' (allowed: '+list.join(', ')+').'); };
      if(k==='box'){
        allow(['size','at','faces','prefix','holes','topEdges','text','ends']);
        if(b.ends!==undefined){ if(!isRecord(b.ends)) err(p+'.ends','must be {"top"?: {…}, "bottom"?: {…}}.');
          else for(const [end,en] of Object.entries(b.ends)){ const q=p+'.ends.'+end;
            if(!['top','bottom'].includes(end)){ err(q,'only the top and bottom ends can have pivot tabs.'); continue; }
            if(!isRecord(en)){ err(q,'must be {"tabs": "front-back" or "left-right", "reach": formula, "hole"?: formula}.'); continue; }
            for(const kk of Object.keys(en)) if(!['tabs','reach','hole'].includes(kk)) err(q+'.'+kk,'is not part of a pivot end (allowed: tabs, reach, hole).');
            if(!['front-back','left-right'].includes(en.tabs)) err(q+'.tabs','must be "front-back" or "left-right" (the two walls that grow tabs).');
            checkF(q+'.reach',en.reach); if(en.hole!==undefined) checkF(q+'.hole',en.hole);
            if(end==='top'&&b.topEdges) for(const w of (en.tabs==='front-back'?['front','back']:['left','right'])) if(b.topEdges[w]!==undefined) err(p+'.topEdges.'+w,'this wall\'s top edge is a pivot tab (ends.top).'); } }
        vec(p+'.size',b.size??['W','D','H'],3); if(b.at!==undefined) vec(p+'.at',b.at,3);
        if(b.faces!==undefined){ if(!Array.isArray(b.faces)||!b.faces.length||!b.faces.every(f=>FACES.includes(f))) err(p+'.faces','must list faces from: '+FACES.join(', ')+'.'); }
        if(b.prefix!==undefined) checkT(p+'.prefix',b.prefix);
        if(b.holes!==undefined){ if(!isRecord(b.holes)) err(p+'.holes','must be {face: [holes]}.'); else for(const [f,hs] of Object.entries(b.holes)){ if(!FACES.includes(f)) err(p+'.holes.'+f,'is not a face.'); else checkHoles(p+'.holes.'+f,hs); } }
        if(b.topEdges!==undefined){ if(!isRecord(b.topEdges)) err(p+'.topEdges','must be {wall: edge}.'); else for(const [f,e] of Object.entries(b.topEdges)){ if(!['front','back','left','right'].includes(f)) err(p+'.topEdges.'+f,'only the walls (front, back, left, right) have a top edge.'); else checkEdge(p+'.topEdges.'+f,e); } }
        if(b.text!==undefined){ if(!isRecord(b.text)||!FACES.includes(b.text.on)) err(p+'.text','must be {"on": face, "rot"?: 0 or 180, "x"?, "y"?}.'); else { if(b.text.rot!==undefined&&![0,180].includes(b.text.rot)) err(p+'.text.rot','must be 0 or 180.'); for(const kk of ['x','y']) if(b.text[kk]!==undefined) checkF(p+'.text.'+kk,b.text[kk]); } }
      }
      else if(k==='panel'){
        allow(['name','size','edges','outline','at','u','v','n','holes','material','role','text']);
        checkT(p+'.name',b.name??'');
        if(typeof b.name!=='string'||!b.name.trim()) err(p+'.name','must name the part (it is printed on the cut sheet).');
        if((b.size===undefined)===(b.outline===undefined)) err(p,'needs either size (a rectangle with edges) or outline (a list of points), not both.');
        if(b.size!==undefined){ vec(p+'.size',b.size,2); const e=b.edges??['e','e','e','e']; if(!Array.isArray(e)||e.length!==4) err(p+'.edges','must list 4 edges: top, right, bottom, left.'); else e.forEach((x,j)=>checkEdge(p+'.edges['+j+']',x)); }
        else if(b.edges!==undefined) err(p+'.edges','only a panel with size has edges.');
        if(b.outline!==undefined){ if(typeof b.outline==='string') checkF(p+'.outline',b.outline); else if(!Array.isArray(b.outline)||b.outline.length<3) err(p+'.outline','must list at least 3 points, or be a formula.'); else b.outline.forEach((q,j)=>vec(p+'.outline['+j+']',q,2)); }
        vec(p+'.at',b.at??[0,0,0],3);
        for(const a of ['u','v','n']) if(b[a]!==undefined) checkAxis(p+'.'+a,b[a]);
        if(b.holes!==undefined) checkHoles(p+'.holes',b.holes);
        if(b.material!==undefined&&!['wood','acrylic'].includes(b.material)) err(p+'.material','must be "wood" or "acrylic".');
        if(b.role!==undefined&&typeof b.role!=='string') err(p+'.role','must be text.');
        if(b.text!==undefined&&(!isRecord(b.text)||(b.text.rot!==undefined&&![0,180].includes(b.text.rot)))) err(p+'.text','must be {"rot"?: 0 or 180, "x"?, "y"?}.');
      }
      else if(k==='dowel'){
        // a round rod you buy: drawn in 3D, listed to buy, never cut
        allow(['name','diameter','length','at','position','axis','count']);
        if(b.name!==undefined){ checkT(p+'.name',b.name); if(typeof b.name!=='string'||!b.name.trim()) err(p+'.name','must be text.'); }
        checkF(p+'.diameter',b.diameter); checkF(p+'.length',b.length);
        if(b.at!==undefined&&b.position!==undefined) err(p,'give the centre as "at" or "position", not both.');
        vec(p+(b.position!==undefined?'.position':'.at'),b.position??b.at??[0,0,0],3);
        checkAxis(p+'.axis',b.axis??'X');
        if(b.count!==undefined) checkF(p+'.count',b.count);
      }
      else if(k==='pivot'){
        // the cross between two tabbed box ends; its "child" frame turns with the joint
        allow(['name','at','bend','swing','size','bendAngle','swingAngle','child','postW','gap','over']);
        if(b.name!==undefined) checkT(p+'.name',b.name);
        vec(p+'.at',b.at??[0,0,0],3); checkAxis(p+'.bend',b.bend??'X'); checkAxis(p+'.swing',b.swing??'Y');
        vec(p+'.size',b.size,2);
        for(const kk of ['bendAngle','swingAngle','postW','gap','over']) if(b[kk]!==undefined) checkF(p+'.'+kk,b[kk]);
        if(typeof b.child!=='string'||!b.child.trim()) err(p+'.child','must name the frame that turns with the joint (parts after it use "frame": that name).'); else checkT(p+'.child',b.child);
      }
      else {
        allow(['at','size','cols','rows','height','prefix']);
        vec(p+'.at',b.at,3); vec(p+'.size',b.size,3);
        for(const kk of ['cols','rows','height']) checkF(p+'.'+kk,b[kk],true);
        if(b.prefix!==undefined) checkT(p+'.prefix',b.prefix);
      }
    }
    if(!errors.length&&Array.isArray(def.parts)&&def.parts.length>200) warn('parts','has '+def.parts.length+' entries; use "for" to repeat parts instead.');
    return {ok:!errors.length,errors,warnings};
  }
  // A list of problems as plain lines, ready to paste back to an AI or show to a person.
  const explain=list=>list.map(e=>(e.path?e.path+': ':'')+e.message).join('\n');

  return {FORMAT,VERSION,EDGES,AXES,FACES,PARAM_KINDS,BUILT_IN_NAMES,FUNCS,CONSTS,FormulaError,parse,evaluate,formula,template,validateType,explain,isRecord};
});
