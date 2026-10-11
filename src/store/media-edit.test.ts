import { beforeEach, describe, it, expect } from 'vitest';
import { createProject, ProjectSchema } from '../domain/schema';
import { mediaRange } from '../domain/media-edit';
import { audioClips } from '../domain/media-timeline';
import { videoTime } from '../domain/video';
import { useEditor } from './editor';

beforeEach(()=>useEditor.getState().loadProject(createProject(),'/tmp/test.abaco.json'));
const video=()=>{useEditor.getState().setFrame(25);useEditor.getState().addVideo({sourcePath:'/clip.mp4',name:'Video',duration:4,aspectRatio:1},'screen');return useEditor.getState().selectedId!;};
const clip=(id:string)=>useEditor.getState().project.objects.find(o=>o.id===id)!;
const audio=(id:string)=>useEditor.getState().project.objects.find(o=>o.kind==='audio'&&o.asset.linkedVideoId===id)!;
const range=(id:string)=>mediaRange(useEditor.getState().project,clip(id));
describe('media editing',()=>{
  it('bounds a short imported video to its source duration inside a longer scene',()=>{
    useEditor.getState().addVideo({sourcePath:'/short.mp4',name:'Short',duration:1,aspectRatio:1},'world');
    const id=useEditor.getState().selectedId!;
    expect(range(id)).toEqual([1,25]);
    expect(clip(id).keyframes.some(key=>key.property==='visibility'&&key.frame===25&&key.value===false)).toBe(true);
  });
  it('trims both video edges using source time and follows matching extracted audio in one undo',()=>{
    const id=video(), before=structuredClone(useEditor.getState().project), count=useEditor.getState().past.length;
    useEditor.getState().trimVideoOnTimeline(id,'start',24);
    expect(range(id)).toEqual([49,121]); expect(clip(id).asset.sourceOffset).toBe(1);
    expect(audio(id).audio.trimStart).toBe(1);expect(mediaRange(useEditor.getState().project,audio(id))).toEqual([49,121]);
    expect(videoTime(49,49,24,4,clip(id).asset.sourceOffset)).toBe(1);
    expect(useEditor.getState().past.length).toBe(count+1);useEditor.getState().undo();expect(useEditor.getState().project).toEqual(before);useEditor.getState().redo();
    useEditor.getState().trimVideoOnTimeline(id,'end',-24);expect(range(id)).toEqual([49,97]);expect(audio(id).audio.trimEnd).toBe(3);
    useEditor.getState().trimVideoOnTimeline(id,'start',-999);expect(range(id)).toEqual([25,97]);expect(clip(id).asset.sourceOffset).toBe(0);
    useEditor.getState().trimVideoOnTimeline(id,'end',999);expect(range(id)).toEqual([25,121]);
  });
  it('moves cut video across scene boundaries with its source offset and matching audio',()=>{
    useEditor.getState().addShot();const id=video();useEditor.getState().setFrame(73);useEditor.getState().splitObjectClip(id);const right=useEditor.getState().selectedId!;
    expect(range(id)).toEqual([25,73]);expect(range(right)).toEqual([73,121]);expect(clip(right).asset.sourceOffset).toBe(2);
    useEditor.getState().moveVideoOnTimeline(right,130);
    expect(range(right)).toEqual([130,178]);expect(clip(right).asset.sourceOffset).toBe(2);expect(mediaRange(useEditor.getState().project,audio(right))).toEqual([130,178]);
    expect(audioClips(useEditor.getState().project,audio(right))[0].sourceStart).toBe(2);
    useEditor.getState().trimVideoOnTimeline(right,'start',12);expect(clip(right).asset.sourceOffset).toBe(2.5);
    const saved=ProjectSchema.parse(JSON.parse(JSON.stringify(useEditor.getState().project)));
    useEditor.getState().loadProject(saved,'/tmp/test.abaco.json');expect(range(right)).toEqual([142,178]);expect(clip(right).asset.sourceOffset).toBe(2.5);
  });
  it('allows audio trim expansion beyond the project end and clamps start to the timeline and source',()=>{
    useEditor.getState().setFrame(1);useEditor.getState().addAudio({sourcePath:'/sound.wav',name:'Audio',duration:4,waveform:[]});
    const id=useEditor.getState().selectedId!;
    useEditor.getState().trimAudioOnTimeline(id,'end',-48);useEditor.getState().moveAudioOnTimeline(id,200);
    expect(range(id)).toEqual([200,248]);useEditor.getState().trimAudioOnTimeline(id,'end',48);expect(range(id)).toEqual([200,296]);
    expect(useEditor.getState().project.settings.frameEnd).toBe(295);
    useEditor.getState().trimAudioOnTimeline(id,'start',24);useEditor.getState().moveAudioOnTimeline(id,1);useEditor.getState().trimAudioOnTimeline(id,'start',-999);
    expect(range(id)?.[0]).toBe(1);expect(clip(id).audio.trimStart).toBe(1);
  });
  it('leaves independently edited audio alone during subsequent video edits',()=>{
    const id=video(), extracted=audio(id).id;
    useEditor.getState().moveAudioOnTimeline(extracted,10);const before=structuredClone(clip(extracted));
    useEditor.getState().moveVideoOnTimeline(id,90);expect(clip(extracted)).toEqual(before);
    useEditor.getState().trimVideoOnTimeline(id,'start',12);expect(clip(extracted)).toEqual(before);
  });
});
