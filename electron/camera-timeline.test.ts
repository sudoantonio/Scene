import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
import {createProject,createSceneObject} from '../src/domain/schema';
import {exportCameraTimeline} from './camera-timeline';
import {cameraBasis} from '../src/domain/camera-space';
describe('Exact camera handoff',()=>{
 it('samples motion, holds, focal changes and camera cuts instead of only the opening pose',()=>{
  const p=createProject();p.settings.frameEnd=6;const c=p.objects[0];
  c.keyframes=[{id:crypto.randomUUID(),frame:1,property:'position',value:[0,0,0],interpolation:'linear',source:'user',commentIds:[]},{id:crypto.randomUUID(),frame:5,property:'position',value:[4,0,0],interpolation:'linear',source:'user',commentIds:[]},{id:crypto.randomUUID(),frame:1,property:'lens',value:35,interpolation:'linear',source:'user',commentIds:[]},{id:crypto.randomUUID(),frame:5,property:'lens',value:55,interpolation:'linear',source:'user',commentIds:[]}];
  c.transform.rotation=[35,23,71];const second=createSceneObject('camera',2);p.objects.push(second);p.cameraCuts.push({...p.cameraCuts[0],id:crypto.randomUUID(),cameraId:second.id,frame:5});
  const out=exportCameraTimeline(p);expect(out.frames.map(f=>f.cameraId)).toEqual([c.id,c.id,c.id,c.id,second.id,second.id]);expect(out.frames[2].position).toEqual([2,0,0]);expect(out.frames[2].lens).toBe(45);
  const [w,x,y,z]=out.frames[0].quaternionWXYZ;const direction=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion(x,y,z,w));expect(direction.distanceTo(cameraBasis(c.transform.rotation)[1])).toBeLessThan(1e-10);
 });
 it('rejects an uncovered first frame instead of inventing a camera',()=>{const p=createProject();p.cameraCuts[0].frame=3;expect(()=>exportCameraTimeline(p)).toThrow('frame 1');});
});
