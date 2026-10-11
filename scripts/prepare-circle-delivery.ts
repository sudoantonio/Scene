import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {ProjectSchema} from '../src/domain/schema';
import {projectForStorage,hydratePortableProject} from '../electron/project-storage';
const folder=path.resolve(process.argv[2]);
for(const name of ['Scena-pronta','Movimento-disegnato','Movimento-registrato','Movimento-verso-modello-importato']) {
 const file=path.join(folder,`${name}.abaco.json`),p=ProjectSchema.parse(JSON.parse(readFileSync(file,'utf8')));
 for(const object of p.objects)if(object.kind==='blend_asset'){object.asset.sourcePath=path.join(folder,'superficie.blend');object.asset.proxyPath=path.join(folder,'superficie.glb');}
 const stored=projectForStorage(p,file);writeFileSync(file,JSON.stringify(stored,null,2));
 const restored=await hydratePortableProject(stored,file,async()=>{throw Error("Unexpected image in circle fixture");});ProjectSchema.parse(restored);
 if(restored.objects.find(o=>o.kind==='blend_asset')?.asset.sourcePath!==path.join(folder,'superficie.blend'))throw Error('Invalid portable asset');
}
