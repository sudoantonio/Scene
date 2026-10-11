const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const delivery = path.resolve(root, '../consegne/Scene-0.59.18-Movimento-Jev');
process.env.SCENE_USER_DATA_DIR = path.join(root, 'work-build/drawing-qa-profile');
Object.defineProperty(app, 'isPackaged', { value: true });
const errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let started = false;
app.on('browser-window-created', (_event, window) => {
  if (started) return;
  started = true;
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  window.webContents.once('did-finish-load', () => run(window).catch(error => {
    console.error(error.stack); fs.writeFileSync(path.join(delivery, 'electron-qa-error.json'), JSON.stringify({ error: error.stack, errors }, null, 2)); app.exit(1);
  }));
});

async function run(window) {
  const wc = window.webContents;
  window.show(); window.focus();
  wc.debugger.attach('1.3');
  const evaluate = source => wc.executeJavaScript(source, true);
  const waitFor = async (predicate, label) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(predicate)) return; await sleep(100); }
    throw new Error(`Timeout: ${label}`);
  };
  const click = async selector => { assert(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(100); };
  const load = async file => {
    const fixture = fs.readFileSync(path.join(delivery, file), 'utf8');
    await evaluate(`localStorage.setItem('abaco-animatic-project-v1', ${JSON.stringify(fixture)})`);
    const ready = new Promise(resolve => wc.once('did-finish-load', resolve)); wc.reload(); await ready;
    await waitFor("Boolean(document.querySelector('.stroke-drawing-toolbar button') && document.querySelector('.canvas-stage canvas'))", 'drawing UI');
    await sleep(900);
  };
  const state = async () => { await sleep(450); return evaluate("JSON.parse(localStorage.getItem('abaco-animatic-project-v1'))"); };
  const strokeCount = project => project.objects.filter(object => object.kind === 'stroke').length;
  const rect = () => evaluate("(() => { const r = document.querySelector('.canvas-stage canvas').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()");
  const mouse = (type, x, y, buttons = 1) => wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0 });
  const escape = async () => {
    await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  };
  const draw = async (options = {}) => {
    const r = await rect(), x = r.x + r.width * .53, y = r.y + r.height * .57;
    await mouse('mousePressed', x, y);
    await sleep(180);
    for (let i = 1; i <= 18; i++) { await mouse('mouseMoved', x + i * 5, y - Math.sin(i / 18 * Math.PI) * 26); await sleep(10); }
    if (options.cancel) await escape();
    if (options.hold) await sleep(options.hold);
    const status = await evaluate("document.querySelector('.stroke-drawing-options output')?.textContent");
    await mouse('mouseReleased', x + 90, y, 0); await sleep(100);
    return status;
  };
  await load('qa-empty.abaco.json');
  await click('.stroke-drawing-toolbar > button');
  await evaluate("window.__strokeEvents = []; window.addEventListener('blur', () => window.__strokeEvents.push('blur')); for (const type of ['pointerdown','pointerup','pointercancel','gotpointercapture','lostpointercapture']) document.querySelector('.canvas-stage canvas').addEventListener(type, e => window.__strokeEvents.push(type + ':' + e.pointerId), true)");
  const noKeyStatus = await draw();
  console.log('FIRST_DRAW_STATUS', noKeyStatus, await evaluate('window.__strokeEvents'));
  fs.writeFileSync(path.join(delivery, 'qa-first-draw.png'), (await wc.capturePage()).toPNG());
  assert(noKeyStatus.includes('chiave TypeSafe/Jev'), noKeyStatus);
  let project = await state(); assert.equal(strokeCount(project), 1);
  const firstStroke = project.objects.find(o => o.kind === 'stroke');
  assert(firstStroke.stroke.points.length >= 15); assert.equal(firstStroke.stroke.normals.length, firstStroke.stroke.points.length);
  await click('button[aria-label="Undo"]'); assert.equal(strokeCount(await state()), 0);
  await click('button[aria-label="Redo"]'); assert.equal(strokeCount(await state()), 1);
  await draw({ cancel: true }); assert.equal(strokeCount(await state()), 1);
  // Reload the actual production renderer and confirm persisted geometry survives.
  const reload = new Promise(resolve => wc.once('did-finish-load', resolve)); wc.reload(); await reload; await sleep(1000);
  assert.equal(strokeCount(await state()), 1);
  const desktopSettings = await evaluate('window.abaco.getSettings()'); assert.equal(desktopSettings.hasJevApiKey, false);

  const requests = [];
  ipcMain.removeHandler('jev:drawing');
  ipcMain.handle('jev:drawing', async (_event, input) => {
    requests.push(input); assert(input.neighbors.length <= 50);
    assert(input.neighbors.every(n => n.distance <= input.radius + 1e-8));
    await sleep(150); return { adherence: .8, continuity: .65 };
  });
  await load('Disegno-3D-Jev.abaco.json');
  await click('.stroke-drawing-toolbar > button');
  const guidedStatus = await draw({ hold: 300 }); assert(guidedStatus.includes('Jev attivo'), guidedStatus);
  project = await state(); assert.equal(strokeCount(project), 4); assert(requests.length > 0);
  await draw({ cancel: true }); assert.equal(strokeCount(await state()), 4);
  fs.writeFileSync(path.join(delivery, 'Disegno-reale-verificato.abaco.json'), JSON.stringify(project, null, 2));
  fs.writeFileSync(path.join(delivery, 'Anteprima-disegno-3D.png'), (await wc.capturePage()).toPNG());
  // Enter the shot camera using the normal preview control.
  const cameraButton = await evaluate("Array.from(document.querySelectorAll('button')).find(b => /open.*camera|camera.*view|enter.*camera/i.test((b.title || '') + ' ' + (b.getAttribute('aria-label') || '')))?.outerHTML || ''");
  if (cameraButton) {
    await evaluate("Array.from(document.querySelectorAll('button')).find(b => /open.*camera|camera.*view|enter.*camera/i.test((b.title || '') + ' ' + (b.getAttribute('aria-label') || ''))).click()");
    await sleep(700); await draw(); assert.equal(strokeCount(await state()), 5);
  }
  assert.equal(errors.filter(message => /Unrecoverable|TypeError|ReferenceError|WebGL.*INVALID/.test(message)).length, 0, errors.join('\n'));
  fs.writeFileSync(path.join(delivery, 'electron-qa.json'), JSON.stringify({ passed: true, nativeDrawing: true, missingKeyFallback: true, undoRedo: true, escapeCancellation: true, persistenceReload: true, mockedJev: true, cameraTest: Boolean(cameraButton), requests: requests.map(input => ({ neighbors: input.neighbors.length, radius: input.radius, mode: input.view.mode })), errors }, null, 2));
  console.log('STROKE_ELECTRON_VERIFIED', JSON.stringify({ strokes: strokeCount(await state()), calls: requests.length, cameraTest: Boolean(cameraButton) }));
  window.close(); app.exit(0);
}
require(path.join(root, 'dist-electron/main.cjs'));
