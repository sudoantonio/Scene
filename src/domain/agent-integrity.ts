import type { AbacoProject } from './schema';
import { objectPresenceRange } from './presence';

/** Preserve MCP metadata through timeline edits and deletion of scenes/elements. */
export function reconcileAgentMetadata(project: AbacoProject) {
  const scenes = project.cameraCuts.slice().sort((a,b)=>a.frame-b.frame);
  const ids = new Set(project.objects.map(object=>object.id));
  if (project.storyboard) project.storyboard.beats = project.storyboard.beats.flatMap(beat=>{
    const index=scenes.findIndex(scene=>scene.id===beat.sceneId);
    if(index<0||scenes[index].isGap)return [];
    const length=(scenes[index+1]?.frame??project.settings.frameEnd+1)-scenes[index].frame;
    beat.startOffsetFrames=Math.min(beat.startOffsetFrames,Math.max(0,length-1));
    beat.durationFrames=Math.min(beat.durationFrames,length-beat.startOffsetFrames);
    if(beat.focusElementId){
      const focus=project.objects.find(object=>object.id===beat.focusElementId);
      const start=scenes[index].frame+beat.startOffsetFrames;
      if(!ids.has(beat.focusElementId)||!focus||!objectPresenceRange(focus,start,start+beat.durationFrames))delete beat.focusElementId;
    }
    return [beat];
  });
  if(project.agentMotions)project.agentMotions=project.agentMotions.flatMap(motion=>{
    const object=project.objects.find(object=>object.id===motion.elementId);
    const keys=object?.keyframes.filter(key=>key.directionActionId===motion.id&&key.purpose==='motion')??[];
    if(keys.length<2||!scenes.some(scene=>scene.id===motion.sceneId&&!scene.isGap))return [];
    motion.startFrame=Math.min(...keys.map(key=>key.frame));motion.endFrame=Math.max(...keys.map(key=>key.frame));
    if(motion.beatId&&!project.storyboard?.beats.some(beat=>beat.id===motion.beatId))delete motion.beatId;
    return [motion];
  });
}
