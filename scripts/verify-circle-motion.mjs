import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const delivery=path.resolve(root,'../consegne/Scene-0.59.21-Curva-Minima');
const bundle=process.argv[2];
const profile=path.join(root,'work-build',`${bundle?'circle-packaged-profile':'circle-native-profile'}-${Date.now()}`);await mkdir(profile,{recursive:true});
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const executable=bundle?path.join(bundle,'Contents/MacOS/Scene-0.59.21'):path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const args=bundle?[]:[path.join(root,'scripts/circle-runtime.cjs')];args.push(`--remote-debugging-port=${port}`);
const child=spawn(executable,args,{env:{...process.env,SCENE_USER_DATA_DIR:profile},stdio:['ignore','ignore','pipe']});
let log='';child.stderr.on('data',d=>log+=d);const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try{
  let target;for(let i=0;i<120;i++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page'&&t.url.includes('index.html'));}catch{}if(target)break;await sleep(100);}
  assert(target,'Renderer not started: '+log);
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  let next=0;const pending=new Map();socket.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(!p){if(m.method==='Runtime.exceptionThrown')log+='\n'+JSON.stringify(m.params);return;}pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>reject(new Error('Timeout '+method)),12000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
  const click=async selector=>{assert(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),selector);const r=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',buttons:0,clickCount:1});await sleep(250);};
  const change=async(label,value)=>{await evaluate(`(()=>{const el=document.querySelector('select[aria-label="${label}"]');if(!el)throw Error('Missing select '+${JSON.stringify(label)}+' '+document.querySelector('.stroke-drawing-toolbar').outerHTML);Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(150);};
  for(let i=0;i<100;i++){if(await evaluate("document.readyState==='complete' && Boolean(document.querySelector('.stroke-drawing-toolbar > button'))"))break;await sleep(100);}
  await sleep(1200);
  await send('Page.enable');await send('Runtime.enable');
  const baseline=JSON.parse(await readFile(path.join(delivery,'Scena-pronta.abaco.json'),'utf8'));
  const qa=structuredClone(baseline);qa.objects.find(o=>o.kind==='blend_asset').asset.sourcePath='';qa.objects.find(o=>o.kind==='blend_asset').asset.proxyPath=path.resolve(delivery,qa.objects.find(o=>o.kind==='blend_asset').asset.proxyPath);const fixture=JSON.stringify(qa);
  const sourceId=baseline.objects.find(o=>o.name.startsWith('1 ·')).id,targetId=baseline.objects.find(o=>o.name.startsWith('2 ·')).id,importedId=baseline.objects.find(o=>o.kind==='blend_asset').id;
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__strokeEvents=[];let pressed=false;for(const type of ['pointerdown','pointermove','pointerup','wheel'])window.addEventListener(type,e=>{if(type==='pointerdown')pressed=true;if(pressed||type==='pointermove'||type==='wheel')window.__strokeEvents.push({type,x:e.clientX,y:e.clientY});if(type==='pointerup')pressed=false;},true);`});
  const load=async(value=fixture)=>{await evaluate(`localStorage.setItem('abaco-animatic-project-v1',${JSON.stringify(value)})`);await send('Page.reload');await sleep(2700);assert(await evaluate('Array.isArray(window.__strokeEvents)'), 'Pointer observer not initialized');};
  const activate=async(dest=targetId)=>{
    await click('.stroke-drawing-toolbar > button');
    for(let i=0;i<30;i++){if(await status())break;await sleep(100);}
    if(!await status())await click('.stroke-drawing-toolbar > button');
    assert.equal(await evaluate("Boolean(document.querySelector('.stroke-drawing-options'))"),false,'Pencil must enter selection without menu');
    const g=await graphics(),a=g.objects.find(o=>o.id===sourceId).center,b=g.objects.find(o=>o.id===dest).center;
    const simpleClick=async p=>{await mouse('mouseMoved',p,'left',0);await sleep(30);await mouse('mousePressed',p);await mouse('mouseReleased',p,'left',0);await sleep(90);};
    await simpleClick(a);assert((await status()).includes('Clicca il secondo'),JSON.stringify({status:await status(),events:await evaluate('window.__strokeEvents'),a,b,rect:g.rect,source:g.objects.find(o=>o.id===sourceId),camera:g.camera}));
    await simpleClick(a);assert((await status()).includes('Clicca l’oggetto da muovere'),await status());
    await simpleClick(a);await simpleClick(b);
    assert(await evaluate("Boolean(document.querySelector('.motion-selection-circle'))"),'Second object not selected');
    await simpleClick(a);assert.equal(await evaluate("Boolean(document.querySelector('.motion-selection-circle'))"),false,'First reclick must clear the pair');
    await simpleClick(a);await simpleClick(b);
    assert((await status()).includes('Due oggetti selezionati'),await status());
    const selected=await graphics();assert(selected.pairOutlines.some(o=>o.color==='efae45'&&o.visible),'Missing source outline');assert(selected.pairOutlines.some(o=>o.color==='42c9e8'&&o.visible),'Missing destination outline');
  };
  const graphics=async()=>{
    let last;
    for(let i=0;i<60;i++){
      try{return await evaluate(`(()=>{const canvas=document.querySelector('.canvas-stage canvas');let f=canvas[Object.keys(canvas).find(k=>k.startsWith('__reactFiber'))],s;for(let i=0;f&&i<40;i++,f=f.return)for(let h=f.memoizedState,n=0;h&&n<80;h=h.next,n++)if(h.memoizedState?.current?.scene?.isScene&&h.memoizedState.current.gl)s=h.memoizedState.current.get?.() ?? h.memoizedState.current;if(!s)throw Error('R3F unavailable');const r=canvas.getBoundingClientRect(),objects=[];s.scene.updateMatrixWorld(true);s.scene.traverseVisible(o=>{if(!o.userData.sceneObjectId)return;const vertices=[],unique=new Set();o.traverseVisible(m=>{if(!m.isMesh||m.userData.strokeSkip)return;const glyph=m.geometry.getAttribute('aTroikaGlyphBounds');if(glyph){for(let i=0;i<glyph.count;i++)for(const x of [glyph.getX(i),glyph.getZ(i)])for(const y of [glyph.getY(i),glyph.getW(i)]){const v=m.position.clone().set(x,y,0).applyMatrix4(m.matrixWorld),p=v.clone().project(s.camera);vertices.push({world:v.toArray(),x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2});}return;}if(m.userData.strokeText)return;const a=m.geometry.getAttribute('position');if(!a)return;for(let i=0;i<a.count;i++){const v=m.getVertexPosition(i,m.position.clone()).applyMatrix4(m.matrixWorld),p=v.clone().project(s.camera),k=[v.x,v.y,v.z].map(v=>Math.round(v*1e6)).join(',');if(unique.has(k))continue;unique.add(k);vertices.push({world:v.toArray(),x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2});}});const p=o.getWorldPosition(o.position.clone()).project(s.camera);objects.push({id:o.userData.sceneObjectId,position:o.position.toArray(),center:{x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2},vertices});});return{objects,rect:{x:r.x,y:r.y,width:r.width,height:r.height},camera:s.camera.matrixWorld.toArray(),projection:s.camera.projectionMatrix.toArray(),pairOutlines:s.scene.children.filter(o=>o.type==='BoxHelper'&&o.userData.strokeSkip).map(o=>({color:o.material.color.getHexString(),visible:o.visible}))};})()`);}
      catch(error){last=error;if(!String(error).includes('R3F unavailable'))throw error;await sleep(100);}
    }
    throw last;
  };
  const controls=()=>evaluate(`(()=>{const canvas=document.querySelector('.canvas-stage canvas');let f=canvas[Object.keys(canvas).find(k=>k.startsWith('__reactFiber'))],s;for(let i=0;f&&i<40;i++,f=f.return)for(let h=f.memoizedState,n=0;h&&n<80;h=h.next,n++)if(h.memoizedState?.current?.scene?.isScene&&h.memoizedState.current.gl)s=h.memoizedState.current.get?.()??h.memoizedState.current;const result=[];s.scene.traverseVisible(o=>{if(o.userData.motionControl)result.push({id:o.userData.motionKeyId,scale:o.scale.x});});return result;})()`);
  const mouse=(type,p,button='left',buttons=1)=>send('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:type==='mouseMoved'?'none':button,buttons,clickCount:type==='mousePressed'?1:0});
  const wheel=(p,deltaY)=>send('Input.dispatchMouseEvent',{type:'mouseWheel',x:p.x,y:p.y,deltaX:0,deltaY});
  const escape=async()=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});};
  const project=async()=>{await sleep(750);return evaluate("JSON.parse(localStorage.getItem('abaco-animatic-project-v1'))");};
  const keys=p=>p.objects.find(o=>o.id===sourceId).keyframes.filter(k=>k.property==='position'&&k.purpose==='motion').sort((a,b)=>a.frame-b.frame);
  const status=()=>evaluate("document.querySelector('.stroke-drawing-feedback output')?.textContent");
  const radius=()=>evaluate("document.querySelector('.motion-selection-circle').getBoundingClientRect().width/2-2");
  const sourcePick=async(g)=>{const p=g.objects.find(o=>o.id===sourceId).center;await mouse('mouseMoved',p,'left',0);await wheel(p,-250);await sleep(80);return p;};
  const draw=async(a,b,{rec=false,cancel=false,invalid=false,straight=false}={})=>{
    await sleep(250);
    const originalLive=(await graphics()).objects.find(o=>o.id===sourceId).position;
    await evaluate('window.__strokeEvents=[]');
    await mouse('mousePressed',a);await sleep(40);
    const cameraBefore=(await graphics()).camera;
    const radiusBefore=await radius();let radiusDuring;
    for(let i=1;i<=18;i++){const t=i/18,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t-(straight?0:25*Math.sin(t*Math.PI))};await mouse('mouseMoved',p);if(i===8){await wheel(p,-120);radiusDuring=await radius();}await sleep(rec?50:8);}
    const live=await graphics();assert.deepEqual(live.camera,cameraBefore,'Camera moved');assert(radiusDuring>radiusBefore+5,'Wheel did not resize during normal drag');
    assert(live.objects.find(o=>o.id===sourceId).position.some((v,i)=>Math.abs(v-originalLive[i])>.01),'Missing live movement');
    assert(await evaluate("Boolean(document.querySelector('.motion-selection-circle'))"),'Circle disappeared');
    if(rec)await sleep(250);
    if(cancel)await escape();
    const end=invalid?{x:live.rect.x+10,y:live.rect.y+10}:b;
    await mouse('mouseReleased',end,'left',0);await sleep(120);return {live,radiusBefore,radiusDuring};
  };
  await load();await activate();assert.equal(await evaluate("document.querySelector('.stroke-drawing-toolbar > button').textContent"),'');
  let g=await graphics();const imported=g.objects.find(o=>o.id===importedId);assert(imported.vertices.length>100,'Imported mesh failed to load');
  const a=await sourcePick(g),b=g.objects.find(o=>o.id===targetId).center;
  const sourceRadius=await radius(),selected=g.objects.find(o=>o.id===sourceId).vertices.filter(v=>Math.hypot(v.x-a.x,v.y-a.y)<=sourceRadius+3);assert(selected.length>0);
  await draw(a,b);const endRadius=await radius();let saved=await project(),pathKeys=keys(saved);assert.equal(pathKeys.length,2);assert.equal(saved.objects.length,baseline.objects.length);
  const cam=new THREE.PerspectiveCamera();cam.matrix.fromArray(g.camera);cam.matrix.decompose(cam.position,cam.quaternion,cam.scale);cam.updateMatrixWorld(true);cam.matrixWorldInverse.copy(cam.matrixWorld).invert();cam.projectionMatrix.fromArray(g.projection);cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  const n=cam.getWorldDirection(new THREE.Vector3()),depth=vertices=>vertices.reduce((s,v)=>s+n.dot(new THREE.Vector3(...v.world)),0)/vertices.length;
  const sourceDepth=depth(selected),destination=g.objects.find(o=>o.id===targetId).vertices.filter(v=>Math.hypot(v.x-b.x,v.y-b.y)<=endRadius+3);assert(destination.length>50,'No arbitrary 50 limit');
  const sourcePlane=new THREE.Plane(n,-sourceDepth),ray=new THREE.Raycaster();
  const planePoint=p=>{ray.setFromCamera(new THREE.Vector2((p.x-g.rect.x)/g.rect.width*2-1,1-(p.y-g.rect.y)/g.rect.height*2),cam);return ray.ray.intersectPlane(sourcePlane,new THREE.Vector3());};
  const startAnchor=planePoint(a),endAnchor=planePoint(b).addScaledVector(n,depth(destination)-sourceDepth);
  const expected=new THREE.Vector3(...baseline.objects.find(o=>o.id===sourceId).transform.position).add(endAnchor).sub(startAnchor);
  assert(new THREE.Vector3(...pathKeys.at(-1).value).distanceTo(expected)<.002,`Wrong endpoint: ${pathKeys.at(-1).value} vs ${expected.toArray()}`);
  assert.equal((await controls()).length,2,'Only endpoints should be visible after drawing');
  const received=await evaluate('window.__strokeEvents');
  const accepted=[];for(const event of received){if(event.type==='wheel')continue;const last=accepted.at(-1);if(!last||event.type==='pointerup'||Math.hypot(event.x-last.x,event.y-last.y)>=3)accepted.push(event);}
  const raw=accepted.map(planePoint);
  const lateralLength=raw.slice(1).reduce((sum,p,i)=>sum+p.distanceTo(raw[i]),0);
  const fullPath=pathKeys.flatMap((key,i)=>i===pathKeys.length-1?[key.value]:key.positionPath?key.positionPath.slice(0,-1):[key.value]);
  const actualLength=fullPath.slice(1).reduce((sum,p,i)=>sum+new THREE.Vector3(...p).distanceTo(new THREE.Vector3(...fullPath[i])),0);
  assert(Math.abs(actualLength-Math.hypot(lateralLength,depth(destination)-sourceDepth))<.003,`Curve did not attain the surface minimum length: actual=${actualLength}, expected=${Math.hypot(lateralLength,depth(destination)-sourceDepth)}, lateral=${lateralLength}, pathPoints=${fullPath.length}`);
  assert(pathKeys.some(k=>k.positionPath),'Corners between frames must survive');
  await writeFile(path.join(delivery,'Movimento-disegnato.abaco.json'),JSON.stringify(saved,null,2));
  {const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(delivery,'Anteprima-curva.png'),Buffer.from(shot.data,'base64'));}
  await click('button[aria-label="Undo"]');assert.equal(keys(await project()).length,0);await click('button[aria-label="Redo"]');assert.equal(keys(await project()).length,pathKeys.length);
  const reloaded=saved;await send('Page.reload');await sleep(1500);assert.equal(keys(await project()).length,pathKeys.length);
  // Invalid release and Escape must leave the prior project intact.
  await load();await activate();g=await graphics();let pa=await sourcePick(g),pb=g.objects.find(o=>o.id===targetId).center;await draw(pa,pb,{invalid:true});assert.equal(keys(await project()).length,0);assert((await status()).includes('Nessun punto'),await status());
  await draw(pa,pb,{cancel:true});assert.equal(keys(await project()).length,0);
  // Existing REC control still records live time and a single session undo.
  await click('button[aria-label="Record motion"]');await draw(pa,pb,{rec:true});saved=await project();const recorded=keys(saved);assert(recorded.length>=15);assert(recorded.at(-1).frame>=baseline.settings.fps);
  await click('button[aria-label="Stop motion recording"]');await click('button[aria-label="Undo"]');assert.equal(keys(await project()).length,0);await click('button[aria-label="Redo"]');assert.equal(keys(await project()).length,recorded.length);
  await writeFile(path.join(delivery,'Movimento-registrato.abaco.json'),JSON.stringify(await project(),null,2));
  // Imported destination must also provide actual selectable vertices.
  await load();await activate(importedId);g=await graphics();pa=await sourcePick(g);pb=g.objects.find(o=>o.id===importedId).center;await draw(pa,pb);assert.equal(keys(await project()).length,2);
  await writeFile(path.join(delivery,'Movimento-verso-modello-importato.abaco.json'),JSON.stringify(await project(),null,2));
  // Actual glyph geometry and the shot camera use the same two-object workflow.
  const textId=baseline.objects.find(o=>o.kind==='text').id;
  await load();await activate(textId);g=await graphics();assert(g.objects.find(o=>o.id===textId).vertices.length>=20,'Text glyphs unavailable');pa=await sourcePick(g);pb=g.objects.find(o=>o.id===textId).center;await draw(pa,pb);assert.equal(keys(await project()).length,2);
  await load();await click('.live-camera-preview-open');
  for(let i=0;i<40;i++){const view=await graphics(),position=baseline.objects.find(o=>o.kind==='camera').transform.position;if(position.every((v,j)=>Math.abs(v-view.camera[12+j])<.001))break;await sleep(100);}
  await sleep(250);await activate();g=await graphics();pa=await sourcePick(g);pb=g.objects.find(o=>o.id===targetId).center;await draw(pa,pb);assert.equal(keys(await project()).length,2);
  // Two adjacent cubes reproduce the user's scene and use only ordinary clicks and drag.
  const cubes=JSON.parse(fixture);cubes.objects=cubes.objects.filter(o=>o.kind==='camera'||o.id===sourceId||o.id===targetId);
  const firstCube=cubes.objects.find(o=>o.id===sourceId),secondCube=cubes.objects.find(o=>o.id===targetId);
  firstCube.transform.position=[-1.1,0,1];firstCube.transform.scale=[.8,.8,.8];secondCube.kind='cube';secondCube.transform.position=[1.1,0,1];secondCube.transform.scale=[.8,.8,.8];
  await load(JSON.stringify(cubes));await activate();g=await graphics();pa=await sourcePick(g);pb=g.objects.find(o=>o.id===targetId).center;await draw(pa,pb,{straight:true});assert.equal(keys(await project()).length,2);
  const straightKeys=keys(await project()),straightA=new THREE.Vector3(...straightKeys[0].value),straightB=new THREE.Vector3(...straightKeys.at(-1).value),straightDelta=straightB.clone().sub(straightA);
  for(const key of straightKeys)assert(new THREE.Vector3(...key.value).sub(straightA).cross(straightDelta).length()/straightDelta.length()<1e-5,'Straight gesture acquired a 3D bend beyond pointer precision');
  await writeFile(path.join(delivery,'Due-cubi-movimento.abaco.json'),JSON.stringify(await project(),null,2));
  {const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(delivery,'Anteprima-retta.png'),Buffer.from(shot.data,'base64'));}
  // Direct viewport selection uses the same ordered flow.
  await load();await click('.stroke-drawing-toolbar > button');g=await graphics();pa=g.objects.find(o=>o.id===sourceId).center;pb=g.objects.find(o=>o.id===targetId).center;
  await mouse('mousePressed',pa,'left',1);await mouse('mouseReleased',pa,'left',0);await mouse('mousePressed',pb,'left',1);await mouse('mouseReleased',pb,'left',0);await mouse('mouseMoved',pa,'left',0);await sleep(120);assert(await evaluate("Boolean(document.querySelector('.motion-selection-circle'))"),'Viewport pair selection failed');
  await sourcePick(g);assert.equal(await evaluate("Boolean(document.querySelector('.jev-floating-composer'))"),false,'AI menu overlaps drawing');
  const screenshot=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(delivery,bundle?'Anteprima-app.png':'Anteprima-cerchio.png'),Buffer.from(screenshot.data,'base64'));
  const report={passed:true,version:'0.59.21',packaged:Boolean(bundle),orderedObjectSelection:true,viewportObjectSelection:true,menuCloses:true,persistentCircle:true,wheelDuringNormalDrag:true,normalClickToggle:true,twoAdjacentCubes:true,normalDragWithoutExtraClick:true,twoColoredOutlines:true,sourcePoints:selected.length,destinationPoints:destination.length,constrainedPlaneEndpoint:true,pickedOffsetPreserved:true,livePreview:true,cameraLocked:true,invalidReleaseRollback:true,escapeRollback:true,recordedPositionKeys:recorded.length,realTimeRec:true,undoRedo:true,reopen:true,importedDestination:true,textDestination:true,cameraView:true,aiMenuHidden:true,onlyEndpointControls:true,twoSavedMotionKeys:true,minimumSurfaceLength:true,straight3DGesture:true,cornersBetweenFrames:true};
  await writeFile(path.join(delivery,bundle?'packaged-circle-qa.json':'native-circle-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await writeFile(path.join(delivery,'circle-qa-error.json'),JSON.stringify({error:error.stack,log},null,2));throw error;}finally{socket?.close();child.kill('SIGTERM');}
