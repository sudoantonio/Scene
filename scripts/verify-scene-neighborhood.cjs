const {app,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),delivery=path.resolve(root,'../consegne/Scene-0.59.19-Scena-completa');
process.env.SCENE_USER_DATA_DIR=path.join(root,'work-build/complete-scene-qa-profile');Object.defineProperty(app,'isPackaged',{value:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));const requests=[],errors=[];let started=false;
app.on('browser-window-created',(_,window)=>{if(started)return;started=true;window.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message);});window.webContents.once('did-finish-load',()=>run(window).catch(error=>{console.error(error.stack);fs.writeFileSync(path.join(delivery,'scene-qa-error.json'),JSON.stringify({error:error.stack,errors},null,2));app.exit(1);}));});
async function run(window){
 window.show();window.focus();const wc=window.webContents;wc.debugger.attach('1.3');const evaluate=code=>wc.executeJavaScript(code,true);
 const click=async selector=>{assert(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await sleep(150);};
 const waitFor=async(code,label)=>{for(let i=0;i<150;i++){if(await evaluate(code))return;await sleep(100);}throw Error('Timeout: '+label);};
 const fixture=fs.readFileSync(path.join(delivery,'qa-scene.abaco.json'),'utf8'),baseline=JSON.parse(fixture);
 const load=async()=>{await evaluate(`localStorage.setItem('abaco-animatic-project-v1',${JSON.stringify(fixture)})`);const ready=new Promise(resolve=>wc.once('did-finish-load',resolve));wc.reload();await ready;await sleep(1700);
 await evaluate(`(() => {const canvas=document.querySelector('.canvas-stage canvas');let f=canvas[Object.keys(canvas).find(k=>k.startsWith('__reactFiber'))];for(let level=0;f&&level<40;level++,f=f.return)for(let h=f.memoizedState,n=0;h&&n<80;h=h.next,n++){const s=h.memoizedState?.current;if(s?.scene?.isScene&&s.gl)window.__qaScene=s;}})()`);
 await waitFor(`(() => {if(!window.__qaScene)return false;let ready=false;window.__qaScene.scene.traverse(o=>{if(o.geometry?.getAttribute('aTroikaGlyphBounds')?.count>0)ready=true;});return ready;})()`,'real text glyphs');};
 ipcMain.removeHandler('jev:drawing');ipcMain.handle('jev:drawing',async(_,input)=>{requests.push(input);assert(input.neighbors.length<=50);assert(input.neighbors.every(n=>n.distance<=input.radius+1e-7));await sleep(100);return{adherence:.8,continuity:.6};});
 const mouse=(type,x,y,buttons=1)=>wc.debugger.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mousePressed'?1:0});
 const begin=async()=>{const r=await evaluate(`(() => {const r=document.querySelector('.canvas-stage canvas').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};})()`);const x=r.x+r.w*.58,y=r.y+r.h*.56;await mouse('mousePressed',x,y);await sleep(180);assert.equal(await evaluate(`Boolean(document.querySelector('.stroke-drawing-options'))`),false,'Menu remains while drawing');return{x,y};};
 const draw=async()=>{const{x,y}=await begin();for(let i=1;i<=16;i++){await mouse('mouseMoved',x+i*5,y-20*Math.sin(i/16*Math.PI));await sleep(20);}await mouse('mouseReleased',x+80,y,0);await sleep(550);};
 const saved=async()=>{await sleep(450);return evaluate(`JSON.parse(localStorage.getItem('abaco-animatic-project-v1'))`);};
 await load();assert.equal(baseline.objects.filter(o=>o.kind==='stroke').length,0);
 await click('.slim-headbar .stroke-drawing-toolbar > button');await click('[data-drawing-mode=stroke]');assert.equal(await evaluate(`Boolean(document.querySelector('.stroke-drawing-options'))`),false,'Choosing stroke did not close the menu');
 await draw();assert(requests.length>0);const first=requests[0];assert(first.neighbors.every(n=>n.kind==='surface'),JSON.stringify(first.neighbors));
 for(const name of ['Oggetto da animare','Superficie della scena','Scritta 3D','Immagine 3D','Modello importato','sfondo.obj','Scritta 2D'])assert(first.neighbors.some(n=>n.name===name),`Missing ${name}: ${JSON.stringify(first.neighbors.map(n=>[n.name,n.source,n.distance]))}`);
 assert(first.neighbors.some(n=>n.text==='SCENA'&&n.source==='object'));assert(first.neighbors.some(n=>n.text==='TESTO 2D'&&n.source==='screen'));
 let project=await saved();assert.equal(project.objects.filter(o=>o.kind==='stroke').length,1);
 // Reopening settings keeps the pencil enabled and the next gesture closes them.
 await click('.stroke-drawing-toolbar > button');assert(await evaluate(`Boolean(document.querySelector('.stroke-drawing-options'))`));await draw();assert.equal((await saved()).objects.filter(o=>o.kind==='stroke').length,2);
 assert(requests.some(r=>r.neighbors.some(n=>n.kind==='point')),'Existing strokes missing');
 // The ordinary camera view includes the actual 2D text rectangles too.
 await click('.live-camera-preview-open');await sleep(700);await draw();assert.equal((await saved()).objects.filter(o=>o.kind==='stroke').length,3);
 fs.writeFileSync(path.join(delivery,'Anteprima-scena-completa.png'),(await wc.capturePage()).toPNG());
 // REC still uses all eligible geometry and excludes only its moving object.
 await load();await click('.stroke-drawing-toolbar > button');await click('[data-drawing-mode=motion]');const targetId=baseline.objects.find(o=>o.name==='Oggetto da animare').id;
 await evaluate(`(()=>{const el=document.querySelector('[aria-label="Oggetto da muovere"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(targetId)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await click('button[aria-label="Record motion"]');const start=requests.length;const{x,y}=await begin();for(let i=1;i<=20;i++){await mouse('mouseMoved',x+i*4,y-18*Math.sin(i/20*Math.PI));await sleep(45);}await mouse('mouseReleased',x+80,y,0);await sleep(650);
 assert(requests.slice(start).every(r=>r.neighbors.every(n=>n.objectId!==targetId)));
 await click('button[aria-label="Stop motion recording"]');project=await saved();assert(project.objects.find(o=>o.id===targetId).keyframes.filter(k=>k.property==='position'&&k.purpose==='motion').length>15);
 const fatal=errors.filter(e=>/Unrecoverable|TypeError|ReferenceError|WebGL.*INVALID/.test(e));assert.equal(fatal.length,0,fatal.join('\n'));
 fs.writeFileSync(path.join(delivery,'Disegno-verificato-su-scena-completa.abaco.json'),JSON.stringify(project,null,2));
 fs.writeFileSync(path.join(delivery,'scene-neighborhood-qa.json'),JSON.stringify({passed:true,noSavedStrokes:first.neighbors.map(n=>({name:n.name,source:n.source,kind:n.elementKind,text:n.text})),textGlyphsLoaded:true,objects:true,importedModel:true,importedBackground:true,images:true,screenText:true,mixedPointsAndSurfaces:true,menuClosedOnStrokeChoice:true,menuClosedDuringGesture:true,settingsReopenWithoutDeactivating:true,cameraView:true,recording:true,maxNeighbors:Math.max(...requests.map(r=>r.neighbors.length)),errors},null,2));
 console.log('COMPLETE_SCENE_VERIFIED',first.neighbors.map(n=>n.name));window.close();app.exit(0);
}
require(path.join(root,'dist-electron/main.cjs'));
