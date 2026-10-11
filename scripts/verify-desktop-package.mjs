import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = process.cwd();
const packaged = path.resolve(process.argv[2] ?? (process.platform === 'darwin' ? 'release/mac-arm64/Scene-0.59.22.app' : 'release/linux-unpacked'));
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const executable = process.platform === 'darwin' ? path.join(packaged, 'Contents/MacOS', path.basename(packaged, '.app')) : path.join(packaged, 'scene');
const resources = process.platform === 'darwin' ? path.join(packaged, 'Contents/Resources') : path.join(packaged, 'resources');
const output = path.join(root, 'work-build/packaged-qa');
const profile = path.join(output, `profile-${process.platform}`);
await rm(profile, { recursive: true, force: true });
await mkdir(profile, { recursive: true });
const env = { ...process.env, SCENE_USER_DATA_DIR: profile };
const flags = process.platform === 'linux' ? ['--no-sandbox', '--use-angle=swiftshader'] : [];
const app = spawn(executable, flags, { env, stdio: ['ignore', 'ignore', 'pipe'] });
let nativeLog = '';
app.stderr.on('data', data => { nativeLog += data; });
const client = new Client({ name: 'scene-packaged-qa', version: '1.0' });
const transport = new StdioClientTransport({ command: path.join(resources, 'scene-mcp'), args: [], env });
const checks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 17); checks.push('17 packaged MCP tools');
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
    assert(!result.isError, JSON.stringify(result.content));
    return JSON.parse(result.content.find(item => item.type === 'text').text);
  };
  let state;
  for (let retry = 0; retry < 80; retry++) {
    try { await readFile(path.join(profile, 'agent-connection.json')); state = await call('scene_get_state'); break; }
    catch { if (app.exitCode !== null) break; await delay(250); }
  }
  assert(state, 'Packaged app did not initialize: ' + nativeLog.slice(-2500));
  assert.equal(state.applicationVersion, version); checks.push('packaged app version and native renderer');
  const connection = JSON.parse(await readFile(path.join(profile, 'agent-connection.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${connection.port}/rpc`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({method:'status'}) });
  assert.equal(response.status, 403); checks.push('unauthenticated requests rejected');
  state = await call('scene_apply', { expectedRevision: state.revision, commands: [{ type: 'create_project', name: 'Packaged QA', fps: 24, width: 640, height: 360 }, { type: 'add_scene', name: 'Scene 1', durationFrames: 48 }] });
  state = await call('scene_apply', { expectedRevision: state.revision, commands: [{ type: 'add_element', sceneId: state.scenes[0].id, kind: 'cube', name: 'Cube', transform: {position:[0,0,1]} }] });
  const preview = await client.callTool({ name: 'scene_preview', arguments: { frames: [1] } }, undefined, {timeout:90000});
  assert(!preview.isError, JSON.stringify(preview.content));
  const picture = preview.content.find(item => item.type === 'image');
  assert(picture?.data.length > 1000, 'Missing native 3D camera image');
  await writeFile(path.join(output, `camera-${process.platform}.jpg`), Buffer.from(picture.data,'base64')); checks.push('native 3D camera rendering');
  const saved = await call('scene_save', {path:path.join(output, `saved-${process.platform}.abaco.json`)});
  const project = JSON.parse(await readFile(saved.path,'utf8'));
  assert(project.objects.some(object => object.name === 'Cube')); checks.push('packaged save');
  await writeFile(path.join(output, `report-${process.platform}.json`), JSON.stringify({version, checks},null,2));
  console.log(JSON.stringify({version, checks},null,2));
} finally {
  await client.close().catch(()=>{}); app.kill('SIGTERM');
  await writeFile(path.join(output, `native-${process.platform}.log`), nativeLog);
}
