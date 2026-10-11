const { app, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const delivery = path.resolve(root, '../consegne/Scene-0.59.18-Movimento-Jev');
process.env.SCENE_USER_DATA_DIR = path.join(root, 'work-build/motion-qa-profile');
Object.defineProperty(app, 'isPackaged', { value: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], requests = [];
let started = false;
app.on('browser-window-created', (_, window) => {
  if (started) return; started = true;
  window.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message); });
  window.webContents.once('did-finish-load', () => run(window).catch(error => {
    console.error(error.stack); fs.writeFileSync(path.join(delivery, 'motion-electron-error.json'), JSON.stringify({ error: error.stack, errors }, null, 2)); app.exit(1);
  }));
});
async function run(window) {
  window.show(); window.focus(); const wc = window.webContents; wc.debugger.attach('1.3');
  const evaluate = source => wc.executeJavaScript(source, true);
  const click = async selector => { assert(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(120); };
  const change = async (label, value) => {
    await evaluate(`(() => { const el = document.querySelector('[aria-label="${label}"]'); const setter = Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true})); })()`); await sleep(120);
  };
  const load = async file => {
    await evaluate(`localStorage.setItem('abaco-animatic-project-v1', ${JSON.stringify(fs.readFileSync(path.join(delivery, file), 'utf8'))})`);
    const ready = new Promise(resolve => wc.once('did-finish-load', resolve)); wc.reload(); await ready; await sleep(1400);
  };
  const project = async () => { await sleep(450); return evaluate("JSON.parse(localStorage.getItem('abaco-animatic-project-v1'))"); };
  const keys = (p, id) => p.objects.find(o => o.id === id).keyframes.filter(k => k.property === 'position' && k.purpose === 'motion').sort((a,b)=>a.frame-b.frame);
  const graphics = () => evaluate(`(() => {
    const canvas = document.querySelector('.canvas-stage canvas');
    let fiber = canvas[Object.keys(canvas).find(k => k.startsWith('__reactFiber'))], state;
    for (let level=0; fiber && level<40; level++,fiber=fiber.return) for(let h=fiber.memoizedState,n=0;h&&n<80;h=h.next,n++) if(h.memoizedState?.current?.scene?.isScene && h.memoizedState.current.gl) state=h.memoizedState.current;
    if(!state) return {found:false}; const roots=[];
    state.scene.traverseVisible(o=>{ if(o.userData.sceneObjectId) { const meshes=[];o.traverseVisible(c=>{if(c.isMesh)meshes.push({vertices:c.geometry.attributes.position?.count,wireframe:Boolean(c.material.wireframe)});});roots.push({id:o.userData.sceneObjectId,position:o.position.toArray(),meshes});} });
    return {found:true,camera:state.camera.matrixWorld.toArray(),roots};
  })()`);
  const mouse = (type, x, y, buttons=1) => wc.debugger.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mousePressed'?1:0});
  const escape = () => wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  let livePreview = false;
  const draw = async ({cancel=false,recording=false,hold=0}={}) => {
    const r=await evaluate("(() => {const r=document.querySelector('.canvas-stage canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
    const x=r.x+r.width*.65, y=r.y+r.height*.65;
    const cameraBefore=(await graphics()).camera;
    await mouse('mousePressed',x,y); await sleep(100);
    for(let i=1;i<=16;i++){await mouse('mouseMoved',x+i*5,y-Math.sin(i/16*Math.PI)*30);await sleep(recording?45:12);}
    const live=await graphics(); assert.deepEqual(live.camera,cameraBefore,'Camera changed during drawing');
    const moved=live.roots.find(o=>o.id===targetId); assert(moved); assert(Math.hypot(...moved.position.map((v,i)=>v-originalPosition[i]))>.05,'Object did not follow the live cursor'); livePreview=true;
    if(hold)await sleep(hold);
    const status=await evaluate("document.querySelector('.stroke-drawing-options output').textContent");
    if(cancel) await escape();
    await mouse('mouseReleased',x+80,y,0); await sleep(150); return status;
  };
  await load('qa-motion.abaco.json');
  assert.equal(await evaluate("document.querySelector('.stroke-drawing-toolbar > button').textContent"),'');
  assert(await evaluate("Boolean(document.querySelector('.slim-headbar .stroke-drawing-toolbar'))"),'Pencil missing from header');
  let initial=await project(); const targetId=initial.objects.find(o=>o.name==='Oggetto da animare').id, originalPosition=initial.objects.find(o=>o.id===targetId).transform.position;
  const importedId=initial.objects.find(o=>o.kind==='blend_asset').id;
  const imported=(await graphics()).roots.find(o=>o.id===importedId); assert(imported.meshes.some(m=>m.vertices>100&&!m.wireframe),'Imported proxy did not load');
  await click('.stroke-drawing-toolbar > button'); await change('Tipo di disegno 3D','motion'); await change('Oggetto da muovere',targetId);
  const status=await draw(); assert(status.includes('chiave TypeSafe/Jev'),status);
  let saved=await project(); let pathKeys=keys(saved,targetId);
  assert.equal(pathKeys.length,initial.settings.fps*2+1); assert.deepEqual(pathKeys[0].value,originalPosition); assert.equal(saved.objects.length,initial.objects.length);
  assert(pathKeys.every(k=>k.interpolation==='linear'));
  await click('button[aria-label="Undo"]'); assert.equal(keys(await project(),targetId).length,0);
  await click('button[aria-label="Redo"]'); assert.equal(keys(await project(),targetId).length,pathKeys.length);
  const beforeCancel=await project(); await draw({cancel:true}); assert.deepEqual((await project()).objects,beforeCancel.objects);
  const ready=new Promise(resolve=>wc.once('did-finish-load',resolve)); wc.reload();await ready;await sleep(1300);assert.equal(keys(await project(),targetId).length,pathKeys.length);
  // Start the existing REC session using the header control and record actual elapsed time.
  await load('qa-motion.abaco.json'); await click('.stroke-drawing-toolbar > button');await change('Tipo di disegno 3D','motion');await change('Oggetto da muovere',targetId);
  ipcMain.removeHandler('jev:drawing');let inFlight=0,maxInFlight=0;
  ipcMain.handle('jev:drawing',async(_,input)=>{requests.push({at:Date.now(),...input});assert(input.neighbors.length<=50);assert(input.neighbors.every(n=>n.distance<=input.radius+1e-8));assert(input.neighbors.every(n=>!n.id.startsWith(targetId)));inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await sleep(1300);inFlight--;return {adherence:.8,continuity:.65};});
  await evaluate("Array.from(document.querySelectorAll('.stroke-drawing-options button')).find(b=>b.textContent.includes('REC movimento')).click()"); await sleep(150);
  assert(await evaluate("Boolean(document.querySelector('.stroke-drawing-options button[aria-pressed=true]'))"),'REC was not activated');
  const start=Date.now();await draw({recording:true,hold:600});const elapsed=(Date.now()-start)/1000;
  saved=await project();const recordedKeys=keys(saved,targetId); assert(recordedKeys.length>=18,`Recorded keys: ${recordedKeys.length}`);
  assert(recordedKeys.at(-1).frame>=Math.floor((elapsed-.3)*initial.settings.fps),'Elapsed time not recorded');
  const recBeforeCancel=await project(); await draw({cancel:true,recording:true});assert.deepEqual((await project()).objects,recBeforeCancel.objects);
  // Stop through the normal timeline REC control, proving both controls share a session.
  await click('button[aria-label="Stop motion recording"]');assert(await evaluate("Boolean(Array.from(document.querySelectorAll('.stroke-drawing-options button')).find(b=>b.textContent.includes('REC movimento')&&b.getAttribute('aria-pressed')==='false'))"));
  await click('button[aria-label="Undo"]');assert.equal(keys(await project(),targetId).length,0);
  await click('button[aria-label="Redo"]');assert.equal(keys(await project(),targetId).length,recordedKeys.length);
  await sleep(1500); assert.equal(maxInFlight,1);
  const reloaded=new Promise(resolve=>wc.once('did-finish-load',resolve));wc.reload();await reloaded;await sleep(1200);assert.equal(keys(await project(),targetId).length,recordedKeys.length);
  fs.writeFileSync(path.join(delivery,'Movimento-reale-verificato.abaco.json'),JSON.stringify(await project(),null,2));
  await click('.stroke-drawing-toolbar > button');await change('Tipo di disegno 3D','motion');await change('Oggetto da muovere',targetId);
  await evaluate("document.querySelector('.live-camera-preview-open')?.click()");await sleep(600);await draw();
  fs.writeFileSync(path.join(delivery,'Anteprima-movimento-0.59.18.png'),(await wc.capturePage()).toPNG());
  assert.equal(errors.filter(e=>/Unrecoverable|TypeError|ReferenceError|WebGL.*INVALID/.test(e)).length,0,errors.join('\n'));
  fs.writeFileSync(path.join(delivery,'motion-electron-qa.json'),JSON.stringify({passed:true,headerPencil:true,livePreview,fixedDurationPath:true,realTimeRec:true,timelineRecIntegration:true,undoRedo:true,escapePreservesPreviousRecording:true,persistenceReload:true,cameraView:true,importedGeometry:true,missingKeyFallback:true,slowJevNoBlocking:true,maxInFlight,recordedKeys:recordedKeys.length,elapsed,requests:requests.map(r=>({at:r.at,neighbors:r.neighbors.length,radius:r.radius})),errors},null,2));
  console.log('MOTION_ELECTRON_VERIFIED',recordedKeys.length,elapsed);window.close();app.exit(0);
}
require(path.join(root,'dist-electron/main.cjs'));
