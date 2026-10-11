import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, ProjectSchema } from '../domain/schema';
import { agentEditorStatus, agentSceneDetail, agentStoryboardStatus, applyAgentRequest } from './agent-editor';
import { useEditor } from './editor';

beforeEach(()=>useEditor.getState().loadProject(createProject(),'/tmp/mcp-test.abaco.json'));
const command=(commands:unknown[])=>applyAgentRequest({expectedRevision:agentEditorStatus().revision,commands});
describe('restored MCP and current editor',()=>{
  it('preserves storyboard, MCP motions, strokes and source trims across save/reopen',()=>{
    const sceneId=useEditor.getState().project.cameraCuts[0].id;
    command([{type:'add_element',sceneId,kind:'cube',name:'Actor'},{type:'set_storyboard',script:'Ciao',beats:[{sceneId,startOffsetFrames:0,durationFrames:36,intention:'Salutare',visualAction:'Avanza'}]}]);
    const actor=useEditor.getState().project.objects.find(object=>object.name==='Actor')!,beat=agentStoryboardStatus().storyboard.beats[0];
    command([{type:'motion',spec:{sceneId,elementId:actor.id,beatId:beat.id,motion:'move_by',delta:[1,0,0],durationSeconds:.5,startOffsetFrames:0,space:'world'}}]);
    useEditor.getState().addStroke([[0,0,0],[1,0,0]],.02,'#ff0000');
    useEditor.getState().addVideo({sourcePath:'/clip.mp4',name:'Clip',duration:2,aspectRatio:1},'world');
    const id=useEditor.getState().selectedId!;useEditor.getState().trimVideoOnTimeline(id,'start',12);
    const saved=ProjectSchema.parse(JSON.parse(JSON.stringify(useEditor.getState().project)));
    useEditor.getState().loadProject(saved,'/tmp/mcp-test.abaco.json');
    expect(agentStoryboardStatus().storyboard.script).toBe('Ciao');expect(saved.agentMotions).toHaveLength(1);
    expect(saved.objects.find(object=>object.kind==='stroke')?.stroke?.points).toHaveLength(2);
    expect(saved.objects.find(object=>object.id===id)?.asset.sourceOffset).toBe(.5);
    expect(agentSceneDetail(sceneId).motions).toHaveLength(1);
    expect(agentEditorStatus().applicationVersion).toBe('0.59.22');
  });
  it('exposes the actual drawn curve to MCP and replaces only that movement with one undo',()=>{
    useEditor.getState().addObject('cube');const id=useEditor.getState().selectedId!;
    useEditor.getState().applyDrawnMotion(id,[[0,0,0],[1,0,0],[1,2,0]],2,true);
    const before=structuredClone(useEditor.getState().project),sceneId=before.cameraCuts[0].id;
    const motion=agentSceneDetail(sceneId).motions.find(motion=>motion.elementId===id)!;
    expect(motion.durationSeconds).toBe(2);expect(motion.amount).toBe(3);
    const past=useEditor.getState().past.length;
    command([{type:'motion',spec:{sceneId,elementId:id,motion:'move_by',delta:[0,1,0],durationSeconds:1,startOffsetFrames:0,space:'world',replaceMotionId:motion.id}}]);
    expect(useEditor.getState().past.length).toBe(past+1);
    expect(agentSceneDetail(sceneId).motions.find(motion=>motion.elementId===id)?.durationSeconds).toBe(1);
    useEditor.getState().undo();expect(useEditor.getState().project).toEqual(before);
  });
  it('keeps MCP timings synchronized after resizing a motion and deleting an element or scene',()=>{
    const sceneId=useEditor.getState().project.cameraCuts[0].id;
    command([{type:'add_element',sceneId,kind:'cube',name:'Actor'}]);const id=useEditor.getState().project.objects.find(o=>o.name==='Actor')!.id;
    command([{type:'set_storyboard',script:'Text',beats:[{sceneId,startOffsetFrames:0,durationFrames:72,focusElementId:id,intention:'Act',visualAction:'Move'}]},{type:'motion',spec:{sceneId,elementId:id,motion:'move_by',delta:[1,0,0],durationSeconds:1,startOffsetFrames:0,space:'world'}}]);
    useEditor.getState().resizeMotionRange(id,sceneId,1,14);
    expect(useEditor.getState().project.agentMotions?.[0].endFrame).toBe(13);
    useEditor.getState().resizeScene(sceneId,24);expect(useEditor.getState().project.storyboard?.beats[0].durationFrames).toBe(24);
    useEditor.getState().deleteObject(id);const project=ProjectSchema.parse(useEditor.getState().project);
    expect(project.agentMotions).toHaveLength(0);expect(project.storyboard?.beats[0].focusElementId).toBeUndefined();
    useEditor.getState().addShot();useEditor.getState().deleteScene(sceneId);expect(ProjectSchema.parse(useEditor.getState().project).storyboard?.beats).toHaveLength(0);
  });
});
