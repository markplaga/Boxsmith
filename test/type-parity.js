// Compares each type file in types/ with the built-in type it re-expresses, across many settings.
const fs=require('fs'), path=require('path'), {load}=require('../boxsmith-node.js');
const pairs=[['closed','closed-box'],['open','open-tray'],['cubeframe','cube-frame']];
const common=[{},{W:200,D:90,H:40},{W:60,D:60,H:60,dimMode:'inside'},{t:6,fw:12},{tslot:'M3',t:6,fw:14},{corners:'edge'},{corners:'pinwheel'},{W:301,D:117,H:83,t:4.5},{text:'Hello',textSize:12}];
const extra={open:[{handles:true},{notch:true},{notch:true,notchH:20},{cols:3,rows:2},{cols:2,rows:1,divPct:60,handles:true,notch:true},{dimMode:'inside',cols:2}],
  cubeframe:[{beamW:5},{beamW:80},{beamW:25,W:300,D:120,H:90},{dimMode:'inside',beamW:30}],closed:[]};
(async()=>{
  const B=await load({dir:path.join(__dirname,'..')}); let bad=0, n=0;
  const strip=x=>JSON.stringify(x,(k,v)=>typeof v==='number'?Math.round(v*1000)/1000+0:v);
  for(const [built,file] of pairs){
    const def=JSON.parse(fs.readFileSync(path.join(__dirname,'..','types',file+'.json'),'utf8'));
    B.types.register(def);
    for(const s of common.concat(extra[built])){
      n++;
      let a,b; try{ a=B.types.parts({...s,type:built}); }catch(e){ console.log('builtin error',built,s,e.message); bad++; continue; }
      try{ b=B.types.parts({...s,type:file}); }catch(e){ console.log('FILE ERROR',file,JSON.stringify(s),e.message,e.path||''); bad++; continue; }
      const diffs=[];
      if(a.length!==b.length) diffs.push('part count '+a.length+' vs '+b.length+': '+a.map(p=>p.name).join(',')+' | '+b.map(p=>p.name).join(','));
      for(let i=0;i<Math.min(a.length,b.length);i++) for(const k of Object.keys({...a[i],...b[i]})){
        if(strip(a[i][k])!==strip(b[i][k])) diffs.push((a[i].name||'meta')+'.'+k+': '+strip(a[i][k]).slice(0,160)+'\n      vs '+strip(b[i][k]).slice(0,160));
      }
      if(diffs.length){ bad++; console.log('DIFF',built,'vs',file,JSON.stringify(s)); diffs.slice(0,6).forEach(d=>console.log('   ',d)); }
      const c=B.types.check(def,s); if(!c.ok) { bad++; console.log('CHECK',file,JSON.stringify(s),JSON.stringify(c.errors.slice(0,3))); }
    }
  }
  console.log(n+' cases, '+bad+' problems'); B.close(); process.exit(bad?1:0);
})();
