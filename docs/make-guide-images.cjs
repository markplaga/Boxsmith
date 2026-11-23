const fs=require('fs');
// Screenshots for docs/make-api-guide.py. Serve the repo first (python3 -m http.server 8765), then:
//   node docs/make-guide-images.cjs        (set BOXSMITH_CHROME to your Chrome if it isn't /usr/bin/google-chrome)
const path=require('path');
const {chromium}=require(path.join(__dirname,'..','node_modules','playwright-core'));
const OUT=path.join(__dirname,'guide-images')+'/';
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
  const b=await chromium.launch({executablePath:process.env.BOXSMITH_CHROME||'/usr/bin/google-chrome',args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  const page=async(w,h)=>{ const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1}); p.on('pageerror',e=>console.log('ERR',e.message));
    await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1500); return p; };
  // 1: first box in the preview
  let p=await page(1920,1140);
  await p.evaluate(()=>{ localStorage.clear(); const tray=Boxsmith.boxes.create('open',{W:140,D:90,H:42,t:3}); Boxsmith.browser.showBox(tray); });
  await p.waitForTimeout(600); await p.screenshot({path:OUT+'01-tray.png'}); await p.close();
  // 3 and 4: frame with three boxes
  const build=`(()=>{ const frame=Boxsmith.boxes.create('frame',{W:240,D:180,H:50,frameW:24}); const closed=Boxsmith.boxes.create('closed',{W:55,D:45,H:30});
    return Boxsmith.assemblies.create({unit:'mm',boxes:[Boxsmith.assemblies.place(frame),...[-60,0,60].map(x=>Boxsmith.assemblies.place(closed,{position:[x,0,0]}))]}); })()`;
  p=await page(1350,1140);
  await p.evaluate(`Boxsmith.browser.openAssembly(${build}); Boxsmith.browser.showTab('arrange'); Boxsmith.browser.topView();`);
  await p.waitForTimeout(3500); await p.screenshot({path:OUT+'03-top.png'});
  await p.evaluate(()=>{ const d=Boxsmith.browser.getAssembly(); d.boxes[2].position=[0,15,0]; d.boxes[2].rotation=[0,20,0]; Boxsmith.browser.openAssembly(d); Boxsmith.browser.view({yaw:30,pitch:30,zoom:1}); });
  await p.waitForTimeout(3500); await p.screenshot({path:OUT+'04-tilt.png'});
  // new page: duplicate in place, step, colour
  const pic=await p.evaluate(async()=>{
    const a=Boxsmith.assemblies, B=Boxsmith.boxes;
    const cs=B.create('display',{W:120,D:90,H:70});
    const tin=B.create('closed',{W:60,D:60,H:40,look:'walnut'});
    let L=a.create({boxes:[a.place(cs),a.place(tin,{position:[110,0,0]})]});
    L=a.color(L,0,{part:'acrylic',color:'#2f8cff'});
    L=a.duplicate(L,1); L=a.step(L,2,'right');     // copy lands at index 2
    L=a.duplicate(L,1); L=a.step(L,2,'up');        // this copy is now index 2; the first moves to 3
    L=a.color(L,3,{color:'#c0392b'});
    L=a.color(L,2,{part:'Top',color:'#e8b730'});
    const r=await a.render(L,{width:1500,height:900,pitch:28,yaw:30,background:'#ffffff',fit:true});
    return r.png; });
  fs.writeFileSync(OUT+'07-color.png',Buffer.from(pic.split(',')[1],'base64'));
  /* the Place tab with the new rows (not used in the PDF yet)
  await p.evaluate(()=>{ Boxsmith.browser.openAssembly(Boxsmith.assemblies.create({boxes:[Boxsmith.assemblies.place(Boxsmith.boxes.create('display'))]})); selectLayoutBox(0); });
  await p.click('[data-lay-tab="Place"]'); await p.waitForTimeout(300);
  await (await p.$('#layoutCtl')).screenshot({path:OUT+'07-place.png'}); */
  await b.close();
})();
