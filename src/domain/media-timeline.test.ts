import { describe,expect,it } from 'vitest';
import { createProject,createSceneObject } from './schema';
import { audioClips,audioStateAt,renderAudioClip,encodeWav,captionsSrt,visibilityIntervals } from './media-timeline';
import { useEditor } from '../store/editor';
function fixture(){
 const p=createProject();p.settings.fps=10;p.settings.frameEnd=40;
 const o=createSceneObject('audio',1);o.audio={...o.audio,duration:4,trimStart:1,trimEnd:2,volume:.5};o.visible=false;
 o.keyframes=[{id:crypto.randomUUID(),frame:11,property:'visibility',value:true,interpolation:'constant',source:'user',commentIds:[]},{id:crypto.randomUUID(),frame:21,property:'visibility',value:false,interpolation:'constant',source:'user',commentIds:[]}];p.objects.push(o);return {p,o};
}
describe('Mounted media',()=>{
 it('cuts the source at the right sample and bakes gain into the WAV',()=>{
  const {p,o}=fixture();const [clip]=audioClips(p,o);const source=Float32Array.from({length:40},(_,i)=>i/40);
  const rendered=renderAudioClip(clip,[source],10,10);expect(rendered[0]).toHaveLength(10);expect(rendered[0][0]).toBeCloseTo(.125);expect(rendered[0][9]).toBeCloseTo(.2375);
  const wav=encodeWav(rendered,10);const view=new DataView(wav.buffer);expect(view.getUint32(40,true)).toBe(40);expect(view.getInt16(44,true)).toBe(4096);
 });
 it('pauses outside presence and computes the same source offset inside',()=>{
  const {p,o}=fixture();expect(audioStateAt(p,o,1)).toBeUndefined();expect(audioStateAt(p,o,21)).toBeUndefined();expect(audioStateAt(p,o,16)).toEqual({sourceTime:1.5,gain:.5});
 });
 it('preserves edits on reopen, including mute and fades',()=>{
  const {p,o}=fixture();o.audio.muted=true;o.audio.fadeIn=.2;o.audio.fadeOut=.3;useEditor.getState().loadProject(p,'/test.json');
  const loaded=useEditor.getState().project.objects.find(x=>x.id===o.id)!;expect(loaded.audio).toEqual(o.audio);expect(loaded.keyframes).toEqual(o.keyframes);expect(useEditor.getState().project.settings.frameEnd).toBe(40);
 });
 it('applies loops and both fades to each rendered sample',()=>{
  const {p,o}=fixture();o.audio.loop=true;o.audio.trimEnd=1.5;o.audio.fadeIn=.2;o.audio.fadeOut=.2;
  const [clip]=audioClips(p,o);const out=renderAudioClip(clip,[new Float32Array(40).fill(1)],10,10)[0];
  expect(out[0]).toBe(0);expect(out[1]).toBeCloseTo(.25);expect(out[5]).toBe(.5);expect(out[9]).toBeCloseTo(.25);
 });
 it('clips subtitles to the trimmed audio and rebases them to timeline time',()=>{
  const {p,o}=fixture();o.audio.captions=[{id:crypto.randomUUID(),start:0,end:.5,text:'removed'},{id:crypto.randomUUID(),start:.8,end:1.5,text:'visible'}];
  expect(captionsSrt(p)).not.toContain('removed');expect(captionsSrt(p)).toContain('00:00:01,000 --> 00:00:01,500');
 });
 it('respects multiple visibility windows and shot membership',()=>{
  const {p,o}=fixture();o.keyframes.push({id:crypto.randomUUID(),frame:31,property:'visibility',value:true,interpolation:'constant',source:'user',commentIds:[]});
  expect(visibilityIntervals(p,o)).toEqual([[11,21],[31,41]]);expect(audioClips(p,o)).toHaveLength(2);
  o.sceneIds=[crypto.randomUUID()];expect(visibilityIntervals(p,o)).toEqual([]);
 });
 it('changes clip length when the user trims while preserving its timeline start',()=>{
  const {p,o}=fixture();useEditor.getState().loadProject(p,'/test.json');useEditor.getState().updateObject(o.id,{audio:{...o.audio,trimEnd:1.5}});
  const next=useEditor.getState().project;const audio=next.objects.find(x=>x.id===o.id)!;expect(visibilityIntervals(next,audio)).toEqual([[11,16]]);
 });
});
