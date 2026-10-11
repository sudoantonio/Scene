import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delivery = path.resolve(root, '../consegne/Scene-0.59.17-Jev-Drawing');
const bundle = path.resolve(process.argv[2] ?? path.join(root, 'release-05917/mac-arm64/Scene-0.59.17.app'));
const profile = path.join(root, 'work-build/packaged-drawing-qa-profile');
await mkdir(profile, { recursive: true });
const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port; await new Promise(resolve => server.close(resolve));
const child = spawn(path.join(bundle, 'Contents/MacOS/Scene-0.59.17'), [`--remote-debugging-port=${port}`], {
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
  const fixture = await readFile(path.join(delivery, 'Disegno-3D-Jev.abaco.json'), 'utf8');
  await evaluate(`localStorage.setItem('abaco-animatic-project-v1', ${JSON.stringify(fixture)})`); await send('Page.reload'); await sleep(1600);
  await evaluate("document.querySelector('.stroke-drawing-toolbar > button').click()"); await sleep(200);
  assert.equal(await evaluate("document.querySelector('.stroke-drawing-toolbar > button').getAttribute('aria-pressed')"), 'true');
  const rect = await evaluate("(() => { const r = document.querySelector('.canvas-stage canvas').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()");
  const x = rect.x + rect.width * .53, y = rect.y + rect.height * .57;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  // Ignore hover and captured movement outside the viewport.
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0, button: 'none', buttons: 1 });
  for (let i = 1; i <= 16; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + i * 5, y: y - Math.sin(i / 16 * Math.PI) * 25, button: 'none', buttons: 1 }); await sleep(12); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 80, y, button: 'left', buttons: 0 }); await sleep(700);
  const project = await evaluate("JSON.parse(localStorage.getItem('abaco-animatic-project-v1'))");
  assert.equal(project.objects.filter(object => object.kind === 'stroke').length, 4);
  assert.equal(project.objects.at(-1).stroke.points.length, 17, 'Hover or off-canvas events must not add stroke points');
  await writeFile(path.join(delivery, 'Disegno-app-verificata.abaco.json'), JSON.stringify(project, null, 2));
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
  await writeFile(path.join(delivery, 'graphics-qa.json'), JSON.stringify(graphics,null,2));
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(delivery, 'Anteprima-app-0.59.17.png'), Buffer.from(screenshot.data, 'base64'));
  await writeFile(path.join(delivery, 'packaged-app-qa.json'), JSON.stringify({ passed: true, bundle, version: '0.59.17', separateProfile: true, productionRenderer: true, nativeDrawing: true, strokes: 4 }, null, 2));
  console.log('PACKAGED_STROKE_VERIFIED 0.59.17 — 4 permanent strokes');
} finally { socket?.close(); child.kill('SIGTERM'); }
