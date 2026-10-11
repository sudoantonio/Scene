import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawCommittedCapture, registerViewportCapture } from './viewport-capture';
const cleanups: Array<()=>void> = [];
const register = (frame: number, projectId: string, draw = vi.fn()) => { const cleanup = registerViewportCapture({frame, projectId, draw}); cleanups.push(cleanup); return {draw, cleanup}; };
afterEach(()=>{cleanups.forEach(cleanup=>cleanup());cleanups.length=0;});
describe('committed camera capture',()=>{
  it('waits for the requested project and frame instead of capturing stale geometry',async()=>{
    const stale=register(1,'old'); let paint=0; const ready=vi.fn();
    await drawCommittedCapture(25,'new',async()=>{if(++paint===3)register(25,'new',ready);});
    expect(paint).toBe(3); expect(stale.draw).not.toHaveBeenCalled(); expect(ready).toHaveBeenCalledOnce();
  });
  it('does not clear a newly mounted camera when an older root cleans up',async()=>{
    const old=register(1,'project'),fresh=register(2,'project');old.cleanup();
    await drawCommittedCapture(2,'project',async()=>{});expect(fresh.draw).toHaveBeenCalledOnce();
  });
  it('fails without reading a stale buffer if the requested camera never commits',async()=>{
    const stale=register(1,'project');let time=0;
    await expect(drawCommittedCapture(2,'project',async()=>{time+=10;},()=>time,20)).rejects.toThrow('did not finish updating');
    expect(stale.draw).not.toHaveBeenCalled();
  });
});
