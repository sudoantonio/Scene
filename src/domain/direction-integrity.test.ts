import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject, ProjectSchema } from './schema';
import { prepareAnimationProject } from './animation-handoff';
import { assertAnimationHandoff } from './direction-integrity';
import { useEditor } from '../store/editor';
function fixture() {
  const p = createProject();
  p.settings.frameEnd = 120;
  const o = createSceneObject('sphere', 1); p.objects.push(o);
  const action = { id: crypto.randomUUID(), instruction: 'salta spaventato', motion: 'jump_in_place', relation: 'then' as const, startFrame: 14, endFrame: 26, keepInFrame: false, distanceMeters: 1, durationSeconds: .5, durationExplicit: false, decision: { answers: { energy: { score: 3.9 } } } };
  p.directionPlans = [{ id: crypto.randomUUID(), sceneId: crypto.randomUUID(), objectId: o.id, instruction: action.instruction, startFrame: 14, endFrame: 26, actions: [action] }];
  o.keyframes = [13, 19, 24].map((frame, i) => ({ id: crypto.randomUUID(), frame, property: 'position' as const, value: [0, 0, i === 1 ? 2 : 1] as [number, number, number], interpolation: 'bezier' as const, source: 'ai' as const, purpose: 'motion' as const, commentIds: [] }));
  return { p, o };
}
describe('Animation handoff integrity', () => {
  it('repairs the legacy orphan scene and mismatched timing without moving keys', () => {
    const { p, o } = fixture(); const before = structuredClone(o.keyframes);
    const out = prepareAnimationProject(p), plan = out.directionPlans![0], a = plan.actions[0];
    expect(plan.sceneId).toBe(p.cameraCuts[0].id); expect([a.startFrame,a.endFrame]).toEqual([13,24]);
    expect(a.durationSeconds).toBe(11/24); expect(a.performance?.energy).toBe(3.9);
    expect(out.animationBrief).toContain('salta spaventato'); expect(out.animationBrief).toContain('3.90/4');
    expect(o.keyframes).toEqual(before); expect(() => ProjectSchema.parse(out)).not.toThrow(); expect(() => assertAnimationHandoff(out)).not.toThrow();
  });
  it('keeps a custom standard and respects deliberate removal across save/reopen', () => {
    const { p } = fixture(); p.animationStandard = { name:'custom.md',content:'Movimenti controllati',attachedAt:p.updatedAt };
    expect(prepareAnimationProject(p).animationStandard).toEqual(p.animationStandard);
    delete p.animationStandard; p.animationStandardDisabled=true;
    const reopened=prepareAnimationProject(ProjectSchema.parse(JSON.parse(JSON.stringify(prepareAnimationProject(p)))));
    expect(reopened.animationStandard).toBeUndefined(); expect(reopened.animationBrief).toContain('Nessuno standard');
  });
  it('retimes metadata and preview together, including undo', () => {
    const { p,o }=fixture(); useEditor.getState().loadProject(p,'/test.json');
    useEditor.getState().resizeMotionRange(o.id,p.cameraCuts[0].id,30,50);
    const moved=prepareAnimationProject(useEditor.getState().project).directionPlans![0].actions[0];
    expect([moved.startFrame,moved.endFrame]).toEqual([30,49]); expect(moved.durationSeconds).toBe(19/24); expect(moved.durationExplicit).toBe(true);
    useEditor.getState().undo(); expect(useEditor.getState().project.directionPlans![0].actions[0].startFrame).toBe(13);
  });
  it('removes the plan when its motion is deleted',()=>{
    const {p,o}=fixture();useEditor.getState().loadProject(p,'/test.json');useEditor.getState().deleteMotionFromScene(o.id,p.cameraCuts[0].id);
    expect(useEditor.getState().project.directionPlans).toEqual([]);
  });
  it('moves a plan to the new shot after splitting before the action',()=>{
    const {p}=fixture();useEditor.getState().loadProject(p,'/test.json');useEditor.getState().setFrame(10);useEditor.getState().splitScene();
    const out=prepareAnimationProject(useEditor.getState().project);const second=out.cameraCuts.find(c=>c.frame===10)!;
    expect(out.directionPlans![0].sceneId).toBe(second.id);expect(second.actionContinuity).toBe('continue');
  });
  it('shifts later actions when a preceding shot is resized or deleted',()=>{
    const {p}=fixture(); useEditor.getState().loadProject(p,'/test.json');useEditor.getState().setFrame(10);useEditor.getState().splitScene();
    useEditor.getState().resizeScene(p.cameraCuts[0].id,18);
    expect(useEditor.getState().project.directionPlans![0].actions[0].startFrame).toBe(22);
    useEditor.getState().deleteScene(p.cameraCuts[0].id);
    expect(useEditor.getState().project.directionPlans![0].actions[0].startFrame).toBe(4);
  });
  it('reports unresolved missing subjects instead of exporting an apparently valid plan',()=>{
    const {p,o}=fixture();p.objects=p.objects.filter(x=>x.id!==o.id);expect(()=>assertAnimationHandoff(prepareAnimationProject(p))).toThrow('oggetto');
  });
});
