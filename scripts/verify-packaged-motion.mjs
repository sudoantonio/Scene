import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delivery = path.resolve(root, '../consegne/Scene-0.59.18-Movimento-Jev');
const bundle = path.resolve(process.argv[2] ?? path.join(root, 'release-05918/mac-arm64/Scene-0.59.18.app'));
const profile = path.join(root, 'work-build/packaged-motion-qa-profile');
await mkdir(profile, { recursive: true });
const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port; await new Promise(resolve => server.close(resolve));
const child = spawn(path.join(bundle, 'Contents/MacOS/Scene-0.59.18'), [`--remote-debugging-port=${port}`], {
  env: { ...process.env, SCENE_USER_DATA_DIR: profile }, stdio: ['ignore', 'ignore', 'ignore'],
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let i = 0; i < 100; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes('index.html')); } catch {}
    if (target) break; await sleep(100);
  }
  assert(target, 'Packaged renderer did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let id = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data); const request = pending.get(message.id);
    if (!request) return; pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  for (let i = 0; i < 50 && !await evaluate("Boolean(document.querySelector('.stroke-drawing-toolbar button'))"); i++) await sleep(100);
  const fixture = await readFile(path.join(delivery, 'qa-motion.abaco.json'), 'utf8');
  const baseline = JSON.parse(fixture), targetId = baseline.objects.find(object => object.name === 'Oggetto da animare').id;
  const change = async (label, value) => {
    await evaluate(`(() => {const el=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(150);
  };
  const load = async () => { await evaluate(`localStorage.setItem('abaco-animatic-project-v1', ${JSON.stringify(fixture)})`); await send('Page.reload'); await sleep(1600); };
  const activate = async () => { await evaluate("document.querySelector('.slim-headbar .stroke-drawing-toolbar > button').click()");await change('Tipo di disegno 3D','motion');await change('Oggetto da muovere',targetId); };
  const draw = async (rec = false) => {
    const r = await evaluate("(() => {const r=document.querySelector('.canvas-stage canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
    const x=r.x+r.width*.65,y=r.y+r.height*.65;
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
    // These events must not add path points or make an object jump off screen.
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0,button:'none',buttons:0});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0,button:'none',buttons:1});
    for(let i=1;i<=16;i++){ await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+i*5,y:y-Math.sin(i/16*Math.PI)*25,button:'none',buttons:1});await sleep(rec?45:12); }
    await sleep(rec?350:50);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+80,y,button:'left',buttons:0});await sleep(700);
  };
  const keys = project => project.objects.find(object=>object.id===targetId).keyframes.filter(key=>key.property==='position'&&key.purpose==='motion').sort((a,b)=>a.frame-b.frame);
  await load();await activate();assert.equal(await evaluate("document.querySelector('.slim-headbar .stroke-drawing-toolbar > button').textContent"),'');
  await draw();let project=await evaluate("JSON.parse(localStorage.getItem('abaco-animatic-project-v1'))");
  assert.equal(keys(project).length,baseline.settings.fps*2+1);assert.equal(project.objects.length,baseline.objects.length);assert.deepEqual(keys(project)[0].value,baseline.objects.find(object=>object.id===targetId).transform.position);
  assert(keys(project).every(key=>key.value.every(Number.isFinite)&&key.value.every(value=>Math.abs(value)<100)), 'Invalid path position');
  await load();await activate();await evaluate("document.querySelector('button[aria-label=\"Record motion\"]').click()");await sleep(150);await draw(true);
  project=await evaluate("JSON.parse(localStorage.getItem('abaco-animatic-project-v1'))");assert(keys(project).length>=18);assert(keys(project).at(-1).frame>baseline.settings.fps);
  await evaluate("document.querySelector('button[aria-label=\"Stop motion recording\"]').click()");await sleep(200);
  await writeFile(path.join(delivery,'Movimento-app-verificata.abaco.json'),JSON.stringify(project,null,2));
  assert.equal(await evaluate("Boolean(document.querySelector('main[role=alert]'))"), false);
  const graphics = await evaluate(`(() => {
    const canvas = document.querySelector('.canvas-stage canvas');
    let fiber = canvas[Object.keys(canvas).find(key => key.startsWith('__reactFiber'))];
    let state;
    for (let level = 0; fiber && level < 40; level++, fiber = fiber.return) {
      for (let hook = fiber.memoizedState, n = 0; hook && n < 80; hook = hook.next, n++) {
        const value = hook.memoizedState?.current;
        if (value?.scene?.isScene && value.gl) state = value;
      }
    }
    if (!state) return {found:false};
    const items=[];
    state.scene.traverse(object => {
      if (!object.geometry || !object.visible) return;
      object.geometry.computeBoundingBox();
      const b=object.geometry.boundingBox;
      items.push({type:object.type, name:object.name, parent:object.parent?.userData?.sceneObjectId,
        helperFor:object.object?.userData?.sceneObjectId, bounds:b ? [b.min.toArray(),b.max.toArray()] : null,
        color:object.material?.color?.getHexString(), position:object.position.toArray(),scale:object.scale.toArray(),
        count:object.geometry.attributes.position?.count, drawRange:object.geometry.drawRange});
    });
    return {found:true,items};
  })()`);
  await writeFile(path.join(delivery, 'graphics-motion-qa.json'), JSON.stringify(graphics,null,2));
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(delivery, 'Anteprima-app-0.59.18.png'), Buffer.from(screenshot.data, 'base64'));
  await writeFile(path.join(delivery, 'packaged-app-qa.json'), JSON.stringify({ passed: true, bundle, version: '0.59.18', separateProfile: true, productionRenderer: true, headerPencil: true, fixedDurationMotion: true, realTimeRec: true, recordedPositionKeys: keys(project).length }, null, 2));
  console.log('PACKAGED_MOTION_VERIFIED 0.59.18');
} finally { socket?.close(); child.kill('SIGTERM'); }
