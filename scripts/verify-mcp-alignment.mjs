import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'work-build', `mcp-qa-${Date.now()}`);
const profile = path.join(output, 'profile');
await mkdir(profile, { recursive: true });
const assetId = randomUUID();
await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ blenderPath: '/Users/antoniodeluca/Desktop/Blender.app/Contents/MacOS/Blender', reasoning: 'medium' }));
await writeFile(path.join(profile, 'agent-assets.json'), JSON.stringify([{ id: assetId, sourcePath: path.join(root, 'public/editor-demo/audio.wav') }]));
const env = { ...process.env, SCENE_USER_DATA_DIR: profile };
const executable = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const child = spawn(executable, [path.join(root, 'scripts/circle-runtime.cjs')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
let errorLog = '';
child.stderr.on('data', data => { errorLog += data; });
const client = new Client({ name: 'scene-alignment-qa', version: '1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist-electron/mcp-cli.cjs')], env });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { tools: [], checks: [], output };
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
  const expected = ['scene_get_state', 'scene_get_scene', 'scene_get_storyboard', 'scene_validate_timing', 'scene_validate_framing', 'scene_set_storyboard', 'scene_update_story_beat', 'scene_direct_beat', 'scene_list_assets', 'scene_choose_assets', 'scene_apply', 'scene_animate_motion', 'scene_preview', 'scene_preview_motion', 'scene_save', 'scene_export_blender', 'scene_export_folder'].sort();
  assert.deepEqual(tools, expected); report.tools = tools;
  const call = async (name, args = {}) => {
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
      if (!result.isError || !('expectedRevision' in args) || !result.content.some(item => item.type === 'text' && /^(?:Il progetto è cambiato\.|The project changed\.)/.test(item.text))) break;
      await delay(100);
      const fresh = await client.callTool({ name: 'scene_get_state', arguments: {} });
      args = { ...args, expectedRevision: JSON.parse(fresh.content.find(item => item.type === 'text').text).revision };
    }
    assert(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
    const value = result.content.find(item => item.type === 'text');
    return value ? JSON.parse(value.text) : result;
  };
  let state;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { await readFile(path.join(profile, 'agent-connection.json')); state = await call('scene_get_state'); break; }
    catch { await delay(250); }
  }
  assert(state, 'Native renderer did not respond: ' + errorLog.slice(-2000));
  assert.equal(state.applicationVersion, '0.59.22');
  report.checks.push('native version and 17 registered MCP tools');
  assert.equal((await call('scene_list_assets')).length, 1);
  const connection = JSON.parse(await readFile(path.join(profile, 'agent-connection.json'), 'utf8'));
  const unauthorized = await fetch(`http://127.0.0.1:${connection.port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'status' }) });
  assert.equal(unauthorized.status, 403); report.checks.push('authenticated loopback bridge');
  state = await call('scene_apply', { expectedRevision: state.revision, commands: [{ type: 'create_project', name: 'MCP alignment QA', fps: 24, width: 640, height: 360 }, { type: 'add_scene', name: 'Test', durationFrames: 72 }] });
  const sceneId = state.scenes[0].id;
  const oldRevision = state.revision;
  state = await call('scene_apply', { expectedRevision: state.revision, commands: [{ type: 'add_element', sceneId, kind: 'cube', name: 'Actor', transform: { position: [0, 0, 1] } }, { type: 'add_element', sceneId, kind: 'audio', name: 'Test audio', assetId }] });
  const actorId = state.createdElementIds.find(element => element.name === 'Actor').id;
  const stale = await client.callTool({ name: 'scene_apply', arguments: { expectedRevision: oldRevision, commands: [{ type: 'update_element', elementId: actorId, name: 'Stale' }] } });
  assert(stale.isError); report.checks.push('stale edit rejected');
  // Audio metadata is filled asynchronously by the native player. Read the
  // resulting revision before issuing subsequent authored changes.
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await call('scene_get_scene', { sceneId })).audio.some(audio => audio.duration > 0)) break;
    await delay(100);
  }
  state = await call('scene_get_state');
  state = await call('scene_set_storyboard', { expectedRevision: state.revision, script: 'A cube moves.', beats: [{ sceneId, startOffsetFrames: 0, durationFrames: 48, intention: 'Move', visualAction: 'Move to the right', focusElementId: actorId }] });
  const beatId = state.createdBeatIds[0];
  state = await call('scene_update_story_beat', { expectedRevision: state.revision, beatId, dialogue: 'Ciao' });
  state = await call('scene_direct_beat', { expectedRevision: state.revision, beatId, actions: [{ action: 'hold', reason: 'Maintain framing' }] });
  state = await call('scene_animate_motion', { expectedRevision: state.revision, motions: [{ sceneId, beatId, elementId: actorId, motion: 'move_by', delta: [1, 0, 0], space: 'world', durationSeconds: 1, startOffsetFrames: 0 }] });
  const motionId = state.appliedMotions[0].id;
  assert.equal((await call('scene_get_storyboard')).storyboard.beats[0].dialogue, 'Ciao');
  assert((await call('scene_get_scene', { sceneId })).motions.some(motion => motion.id === motionId));
  await call('scene_validate_timing'); await call('scene_validate_framing');
  report.checks.push('storyboard, direction, movement, scene and validators');
  for (const [name, args, filename] of [['scene_preview', { frames: [1, 13, 25] }, 'camera.jpg'], ['scene_preview_motion', { motionId }, 'movement.jpg']]) {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
    assert(!result.isError, JSON.stringify(result));
    const picture = result.content.find(item => item.type === 'image');
    assert(picture?.data.length > 1000, `${name}: missing rendered image`);
    await writeFile(path.join(output, filename), Buffer.from(picture.data, 'base64'));
  }
  report.checks.push('camera contact sheets and timed motion preview');
  const saved = await call('scene_save', { path: path.join(output, 'test.abaco.json') });
  const project = JSON.parse(await readFile(saved.path, 'utf8'));
  assert.equal(project.storyboard.beats[0].dialogue, 'Ciao'); assert.equal(project.agentMotions[0].id, motionId);
  const folder = await call('scene_export_folder', { outputDirectory: path.join(output, 'portable') });
  assert((await stat(path.join(folder.directory, 'project.abaco.json'))).size > 100);
  report.checks.push('save and portable folder with edited audio');
  const exported = await call('scene_export_blender');
  assert((await stat(exported.blendPath)).size > 1000);
  assert((await stat(exported.audioPath)).size > 44);
  report.checks.push('actual Blender export and WAV mix');
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close().catch(() => {});
  child.kill('SIGTERM');
  await writeFile(path.join(output, 'native.log'), errorLog);
}
