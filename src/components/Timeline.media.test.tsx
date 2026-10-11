import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../domain/schema';
import { mediaRange } from '../domain/media-edit';
import { useEditor } from '../store/editor';
import Timeline from './Timeline';

beforeEach(()=>{ useEditor.getState().loadProject(createProject(),'/tmp/clip.abaco.json'); useEditor.getState().setFrame(25); vi.stubGlobal('PointerEvent',MouseEvent); });
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const add=(kind:'audio'|'video')=>{
  if(kind==='audio')useEditor.getState().addAudio({sourcePath:'/sound.wav',name:'Audio',duration:4,waveform:[]});
  else useEditor.getState().addVideo({sourcePath:'/clip.mp4',name:'Video',duration:4,aspectRatio:1},'screen');
  return useEditor.getState().selectedId!;
};
const range=(id:string)=>{const p=useEditor.getState().project;return mediaRange(p,p.objects.find(o=>o.id===id)!);};
describe('media timeline gestures',()=>{
  for(const kind of ['audio','video'] as const){
    it(`cuts ${kind} at the clicked position and keeps repeat clicks at that position`,()=>{
      add(kind);const {container}=render(<Timeline/>); const bar=container.querySelector(`.${kind==='audio'?'audio-layer':'video-layer'}`)!;
      vi.spyOn(bar,'getBoundingClientRect').mockReturnValue({left:100,width:400} as DOMRect);
      fireEvent.click(bar,{clientX:300}); expect(useEditor.getState().currentFrame).toBe(73);
      fireEvent.click(bar,{clientX:300}); expect(useEditor.getState().currentFrame).toBe(73);
      expect(screen.getByRole('button',{name:'Split clip at playhead'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Split clip at playhead'}));
      expect(container.querySelectorAll(`.${kind==='audio'?'audio-layer':'video-layer'}`)).toHaveLength(2);
    });
    it(`cancels ${kind} move on Escape and commits a completed drag in one undo`,()=>{
      const id=add(kind),before=structuredClone(useEditor.getState().project);
      const {container}=render(<Timeline/>);const bar=container.querySelector(`.${kind==='audio'?'audio-layer':'video-layer'}`)!;
      vi.spyOn(bar.closest('.presence-track')!,'getBoundingClientRect').mockReturnValue({width:1200} as DOMRect);
      fireEvent.pointerDown(bar,{button:0,clientX:100});fireEvent.pointerMove(window,{clientX:340});fireEvent.keyDown(window,{key:'Escape'});fireEvent.pointerUp(window,{clientX:340});
      expect(useEditor.getState().project).toEqual(before);
      const count=useEditor.getState().past.length;
      fireEvent.pointerDown(bar,{button:0,clientX:100});fireEvent.pointerMove(window,{clientX:340});fireEvent.pointerUp(window,{clientX:340});fireEvent.click(bar,{clientX:340});
      expect(range(id)?.[0]).toBe(49);expect(useEditor.getState().past.length).toBe(count+1);
      act(()=>useEditor.getState().undo());expect(useEditor.getState().project).toEqual(before);
    });
    it(`resizes ${kind} source offset without a follow-up click seeking or moving the clip`,()=>{
      const id=add(kind),{container}=render(<Timeline/>);const bar=container.querySelector(`.${kind==='audio'?'audio-layer':'video-layer'}`)!;
      vi.spyOn(bar.closest('.presence-track')!,'getBoundingClientRect').mockReturnValue({width:1200} as DOMRect);
      const handle=bar.querySelector(`.${kind==='audio'?'audio-trim-handle':'presence-resize-handle'}.start`)!;
      const beforeFrame=useEditor.getState().currentFrame;
      fireEvent.pointerDown(handle,{button:0,clientX:100});fireEvent.pointerMove(window,{clientX:340});fireEvent.pointerUp(window,{clientX:340});fireEvent.click(handle,{clientX:340});
      expect(range(id)).toEqual([49,121]);expect(useEditor.getState().currentFrame).toBe(beforeFrame);
      const object=useEditor.getState().project.objects.find(o=>o.id===id)!;expect(kind==='audio'?object.audio.trimStart:object.asset.sourceOffset).toBe(1);
    });
  }
  it('ignores another pointer and cancels on pointercancel, blur and unmount',()=>{
    const id=add('audio'),before=structuredClone(useEditor.getState().project),{container,unmount}=render(<Timeline/>);
    const bar=container.querySelector('.audio-layer')!;vi.spyOn(bar.closest('.presence-track')!,'getBoundingClientRect').mockReturnValue({width:1200} as DOMRect);
    const pointer=(name:string,id:number,x:number)=>{const e=new MouseEvent(name,{bubbles:true,button:0,clientX:x});Object.defineProperty(e,'pointerId',{value:id});fireEvent(name==='pointerdown'?bar:window,e);};
    pointer('pointerdown',1,100);pointer('pointermove',2,340);pointer('pointerup',2,340);expect(range(id)).toEqual([25,121]);pointer('pointercancel',1,340);expect(useEditor.getState().project).toEqual(before);
    pointer('pointerdown',1,100);pointer('pointermove',1,340);fireEvent(window,new Event('blur'));pointer('pointerup',1,340);expect(useEditor.getState().project).toEqual(before);
    pointer('pointerdown',1,100);pointer('pointermove',1,340);unmount();pointer('pointerup',1,340);expect(useEditor.getState().project).toEqual(before);
  });
});
