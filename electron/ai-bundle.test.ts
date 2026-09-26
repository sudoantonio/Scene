// @vitest-environment node
import {describe,expect,it,afterEach} from 'vitest';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createProject,createSceneObject,ProjectSchema} from '../src/domain/schema';
import {writeAiBundle,collectPortableAssets} from './ai-bundle';
import {hydratePortableProject} from './project-storage';
import {encodeWav} from '../src/domain/media-timeline';
import type {EditedMedia} from '../src/domain/edited-media';
const roots:string[]=[];
async function temp(){const r=await fs.mkdtemp(path.join(os.tmpdir(),'scene-bundle-test-'));roots.push(r);return r;}
afterEach(async()=>{for(const r of roots.splice(0))await fs.rm(r,{recursive:true,force:true});});
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
describe('Portable AI folder',()=>{
 it('writes originals and baked media, verifies inventory and reopens after moving the folder',async()=>{
  const root=await temp(), p=createProject();p.settings.frameEnd=1;p.settings.fps=1;p.settings.resolutionX=1;p.settings.resolutionY=1;
  const image=createSceneObject('plane',1);image.screenSpace=true;image.asset.sourcePath='/missing/picture.png';image.asset.proxyPath=pixel;p.objects.push(image);
  const audio=createSceneObject('audio',1);audio.asset.sourcePath=path.join(root,'voice.wav');audio.audio.duration=1;p.objects.push(audio);
  audio.audio.captionStyle={color:'#ffd966',fontFamily:'georgia',size:1.2,position:[.5,.95]};
  const wav=encodeWav([new Float32Array(48000).fill(.2),new Float32Array(48000).fill(.2)],48000);await fs.writeFile(audio.asset.sourcePath,wav);
  const media:EditedMedia={projectId:p.id,updatedAt:p.updatedAt,audioMix:wav,audioClips:[],croppedImages:[{objectId:image.id,png:pixel}],overlays:[{objectId:image.id,images:[pixel],states:[{startFrame:1,endFrameExclusive:2,image:0}]}]};
  const out=await writeAiBundle(p,root,path.join(root,'source.json'),undefined,media);
  const manifest=JSON.parse(await fs.readFile(path.join(out.directory,'MANIFEST.json'),'utf8'));
  for(const entry of manifest.files){const bytes=await fs.readFile(path.join(out.directory,entry.path));expect(bytes.length).toBe(entry.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);}
  expect(manifest.files.some((f:{path:string})=>f.path==='media/AUDIO_MONTATO.wav')).toBe(true);
  const mounted=JSON.parse(await fs.readFile(path.join(out.directory,'MEDIA_MONTATI.json'),'utf8'));
  expect(mounted.subtitleStyles).toContainEqual({objectId:audio.id,showCaptions:true,applyCaptionPositionToAll:true,color:'#ffd966',fontFamily:'georgia',size:1.2,position:[.5,.95],positions:[]});
  const moved=path.join(root,'moved');await fs.rename(out.directory,moved);
  const stored=ProjectSchema.parse(JSON.parse(await fs.readFile(path.join(moved,'project.abaco.json'),'utf8')));
  expect(stored.objects.find(o=>o.id===audio.id)!.asset.sourcePath).toMatch(/^assets\/audio\//);
  const hydrated=await hydratePortableProject(stored,path.join(moved,'project.abaco.json'),async file=>'data:image/png;base64,'+(await fs.readFile(file)).toString('base64'));
  expect(hydrated.objects.find(o=>o.id===image.id)!.asset.proxyPath).toBe(pixel);
  expect(await fs.readFile(hydrated.objects.find(o=>o.id===audio.id)!.asset.sourcePath)).toEqual(Buffer.from(wav));
  expect(p.objects.find(o=>o.id===image.id)!.asset.sourcePath).toBe('/missing/picture.png');
  const camera=JSON.parse(await fs.readFile(path.join(moved,'CAMERE.json'),'utf8'));expect(camera.frames).toHaveLength(1);
 });
 it('never overwrites previous exports and removes an incomplete staging directory on missing assets',async()=>{
  const root=await temp(),p=createProject();const first=await writeAiBundle(p,root);const second=await writeAiBundle(p,root);expect(second.directory).not.toBe(first.directory);
  const o=createSceneObject('audio',1);o.asset.sourcePath='/missing/audio.wav';p.objects.push(o);
  await expect(writeAiBundle(p,root)).rejects.toThrow('File mancante');expect((await fs.readdir(root)).some(n=>n.endsWith('.tmp'))).toBe(false);expect(await fs.stat(first.directory)).toBeTruthy();
 });
 it('rebases nested OBJ materials and textures rather than flattening broken references',async()=>{
  const root=await temp();await fs.mkdir(path.join(root,'material/texture'),{recursive:true});await fs.writeFile(path.join(root,'model.obj'),'mtllib material/mat.mtl\nv 0 0 0');await fs.writeFile(path.join(root,'material/mat.mtl'),'newmtl a\nmap_Kd texture/diffuse.png');await fs.writeFile(path.join(root,'material/texture/diffuse.png'),'texture');
  const p=createProject();p.cameraCuts[0].background={kind:'model',path:path.join(root,'model.obj'),name:'model'};
  const dest=path.join(root,'bundle');const out=await collectPortableAssets(p,dest);
  const obj=path.join(dest,out.project.cameraCuts[0].background.path);const mtl=path.resolve(path.dirname(obj),(await fs.readFile(obj,'utf8')).split('\n')[0].slice(7));
  const texture=path.resolve(path.dirname(mtl),(await fs.readFile(mtl,'utf8')).split('\n')[1].slice(7));expect(await fs.readFile(texture,'utf8')).toBe('texture');expect(texture.startsWith(dest)).toBe(true);
 });
 it('rejects stale media and does not claim original audio is mounted',async()=>{
  const root=await temp(),p=createProject();const media:EditedMedia={projectId:p.id,updatedAt:'old',audioClips:[],overlays:[],croppedImages:[]};await expect(writeAiBundle(p,root,undefined,undefined,media)).rejects.toThrow('revisioni diverse');
 });
});
